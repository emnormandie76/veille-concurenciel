/**
 * seed.ts — Prisma Seed Script (Étape 1.2)
 * Crée le compte Admin initial au premier démarrage.
 * Exécuter via : npx prisma db seed
 *
 * Sécurité : utilise bcryptjs (pas de Pydantic, pas de bcrypt natif)
 * Le mot de passe est hashé avec bcryptjs (salt rounds = 12)
 *
 * Le mot de passe N'EST PAS codé en dur : il est lu depuis SEED_ADMIN_PASSWORD
 * et le seed échoue si la variable est absente ou ne respecte pas la politique
 * de lib/password.ts. L'identifiant peut être surchargé via SEED_ADMIN_USERNAME.
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local"), override: true });

import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { validatePassword } from "../lib/password";

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

  const ADMIN_USERNAME = (process.env.SEED_ADMIN_USERNAME ?? "admin").trim();
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

  if (ADMIN_USERNAME.length < 3) {
    throw new Error("SEED_ADMIN_USERNAME doit faire au moins 3 caractères.");
  }

  const existingAdmin = await prisma.user.findUnique({
    where: { username: ADMIN_USERNAME },
  });

  if (existingAdmin) {
    console.log(`✅ L'utilisateur "${ADMIN_USERNAME}" existe déjà. Seed ignoré.`);
    console.log(
      "   Pour changer son mot de passe : PATCH /api/admin/users/<id>/password"
    );
    return;
  }

  const password_hash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  const admin = await prisma.user.create({
    data: {
      username: ADMIN_USERNAME,
      password_hash,
      role: "ADMIN",
    },
  });

  console.log(`✅ Compte Admin créé : ${admin.username} (id: ${admin.id})`);
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
