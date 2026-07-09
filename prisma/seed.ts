/**
 * seed.ts — Prisma Seed Script (Étape 1.2)
 * Crée le compte Admin par défaut au premier démarrage.
 * Exécuter via : npx prisma db seed
 *
 * Sécurité : utilise bcryptjs (pas de Pydantic, pas de bcrypt natif)
 * Le mot de passe est hashé avec bcryptjs (salt rounds = 12)
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local"), override: true });

import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("DB URL =", process.env.DATABASE_URL?.substring(0, 30) + "...");
  const ADMIN_USERNAME = "admin";
  const ADMIN_PASSWORD = "admin"; // À changer immédiatement après le premier login

  const existingAdmin = await prisma.user.findUnique({
    where: { username: ADMIN_USERNAME },
  });

  if (existingAdmin) {
    console.log(`✅ L'utilisateur admin existe déjà. Seed ignoré.`);
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
  console.log(`⚠️  Mot de passe par défaut : "${ADMIN_PASSWORD}"`);
  console.log(`⚠️  Changez ce mot de passe dès le premier login !`);
}

main()
  .catch((e) => {
    console.error("❌ Erreur lors du seed :", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
