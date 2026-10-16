/**
 * seed.ts — Prisma Seed Script (Étape 1.2)
 * Crée le compte Admin initial d'une base **vierge**.
 * Exécuter via : npx prisma db seed
 *
 * Jamais sur la base partagée (CLAUDE.md, règle 8) : elle a déjà ses comptes,
 * et les collègues y entrent par la liste blanche (plan gestion-contenu,
 * étape 2).
 *
 * Sécurité : utilise bcryptjs (pas de Pydantic, pas de bcrypt natif)
 * Le mot de passe est hashé avec bcryptjs (salt rounds = 12)
 *
 * Rien n'est codé en dur : l'adresse est lue depuis SEED_ADMIN_EMAIL (domaine
 * imposé, D5, lib/accounts.ts) et le mot de passe depuis SEED_ADMIN_PASSWORD
 * (politique de lib/password.ts). Le seed échoue si l'une manque ou est
 * refusée. Le compte est créé actif, avec un nom affiché déduit de l'adresse
 * (D6), modifiable ensuite sur « Mon compte ».
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local"), override: true });

import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { validatePassword } from "../lib/password";
import { nameFromEmail, validateWorkEmail } from "../lib/accounts";

/** Affiche l'hôte de la base sans jamais laisser fuiter les identifiants. */
function describeDatabase(url: string | undefined): string {
  if (!url) return "(DATABASE_URL absente)";
  try {
    return new URL(url).host;
  } catch {
    return "(DATABASE_URL illisible)";
  }
}

async function main() {
  console.log("Base cible :", describeDatabase(process.env.DATABASE_URL));

  const checkedEmail = validateWorkEmail(process.env.SEED_ADMIN_EMAIL);
  if (checkedEmail.error !== null) {
    throw new Error(
      `SEED_ADMIN_EMAIL refusée : ${checkedEmail.error}\n` +
        "Définissez-la dans .env.local (ou dans l'environnement de déploiement) avant de lancer le seed."
    );
  }
  const ADMIN_EMAIL = checkedEmail.email;
  const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

  if (!ADMIN_PASSWORD) {
    throw new Error(
      "SEED_ADMIN_PASSWORD n'est pas défini.\n" +
        "Définissez-la dans .env.local (ou dans l'environnement de déploiement) " +
        "avant de lancer le seed. Aucun mot de passe par défaut n'est fourni."
    );
  }

  const policyError = validatePassword(ADMIN_PASSWORD);
  if (policyError) {
    throw new Error(`SEED_ADMIN_PASSWORD refusée : ${policyError}`);
  }

  const existingAdmin = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
  });

  if (existingAdmin) {
    console.log(`✅ Le compte "${ADMIN_EMAIL}" existe déjà. Seed ignoré.`);
    console.log("   Pour changer son mot de passe : « Mon compte » (/account).");
    return;
  }

  const password_hash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  // Un compte actif a un mot de passe (contrainte User_password_status_check) :
  // l'état est écrit ici, le défaut de la base (INVITED) ne convient pas.
  const admin = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      display_name: nameFromEmail(ADMIN_EMAIL),
      password_hash,
      role: "ADMIN",
      status: "ACTIVE",
      first_login_at: new Date(),
    },
  });

  console.log(`✅ Compte Admin créé : ${admin.email} (id: ${admin.id})`);
  console.log("   Mot de passe : celui fourni via SEED_ADMIN_PASSWORD (non journalisé).");
}

main()
  .catch((e) => {
    console.error("❌ Erreur lors du seed :", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
