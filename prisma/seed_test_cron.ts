import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local"), override: true });

import { prisma } from "../lib/prisma";

async function main() {
  console.log("🌱 Début du seed pour les données de test du Cron...");

  // 1. Création / Récupération des écoles
  const hec = await prisma.school.upsert({
    where: { name: "HEC Paris" },
    update: {},
    create: {
      name: "HEC Paris",
      official_domain: "hec.edu",
      status: "ACTIVE",
    },
  });

  const essec = await prisma.school.upsert({
    where: { name: "ESSEC Business School" },
    update: {},
    create: {
      name: "ESSEC Business School",
      official_domain: "essec.edu",
      status: "ACTIVE",
    },
  });

  console.log(`🏫 Écoles prêtes: ${hec.name}, ${essec.name}`);

  // 2. Création / Récupération des campus
  const hecCampus = await prisma.campus.upsert({
    where: { schoolId_name: { schoolId: hec.id, name: "Campus Jouy-en-Josas" } },
    update: {},
    create: {
      schoolId: hec.id,
      name: "Campus Jouy-en-Josas",
      city: "Jouy-en-Josas",
    },
  });

  const essecCampus = await prisma.campus.upsert({
    where: { schoolId_name: { schoolId: essec.id, name: "Campus Cergy-Pontoise" } },
    update: {},
    create: {
      schoolId: essec.id,
      name: "Campus Cergy-Pontoise",
      city: "Cergy-Pontoise",
    },
  });

  console.log("📍 Campus prêts");

  // 3. Création / Récupération des programmes
  const hecPge = await prisma.program.upsert({
    where: { campusId_name: { campusId: hecCampus.id, name: "Grande École (Master in Management)" } },
    update: {},
    create: {
      campusId: hecCampus.id,
      name: "Grande École (Master in Management)",
      is_alternance_possible: false,
    },
  });

  const essecPge = await prisma.program.upsert({
    where: { campusId_name: { campusId: essecCampus.id, name: "Grande École (MIM)" } },
    update: {},
    create: {
      campusId: essecCampus.id,
      name: "Grande École (MIM)",
      is_alternance_possible: true,
    },
  });

  console.log("🎓 Programmes prêts");

  // 4. Création des CronTargets pour tester
  // Supprimer les cibles existantes pour ces écoles pour éviter les conflits
  await prisma.cronTarget.deleteMany({
    where: {
      schoolId: { in: [hec.id, essec.id] },
    },
  });

  // A. Cible active HEC
  const target1 = await prisma.cronTarget.create({
    data: {
      schoolId: hec.id,
      programId: hecPge.id,
      data_category: "Pricing",
      failed_attempts_count: 0,
      is_blacklisted: false,
    },
  });

  // B. Cible en alerte ESSEC (2 échecs)
  const target2 = await prisma.cronTarget.create({
    data: {
      schoolId: essec.id,
      programId: essecPge.id,
      data_category: "Pricing",
      failed_attempts_count: 2,
      is_blacklisted: false,
      last_failed_attempt: new Date(),
    },
  });

  // C. Cible bloquée HEC (3 échecs)
  const target3 = await prisma.cronTarget.create({
    data: {
      schoolId: hec.id,
      programId: hecPge.id,
      data_category: "Ranking",
      failed_attempts_count: 3,
      is_blacklisted: true,
      last_failed_attempt: new Date(Date.now() - 3600000), // il y a 1h
    },
  });

  // D. Cible bloquée ESSEC au niveau École (4 échecs)
  const target4 = await prisma.cronTarget.create({
    data: {
      schoolId: essec.id,
      programId: null, // Niveau école
      data_category: "Program_Discovery",
      failed_attempts_count: 4,
      is_blacklisted: true,
      last_failed_attempt: new Date(Date.now() - 7200000), // il y a 2h
    },
  });

  console.log("🛡️ Cibles Cron de test créées avec succès !");
  console.log("   - [HEC Paris] Pricing : Actif (0/3 échecs)");
  console.log("   - [ESSEC] Pricing : En échec (2/3 échecs) — Statut Orange");
  console.log("   - [HEC Paris] Ranking : Bloqué (3/3 échecs) — Statut Rouge, bouton Débloquer");
  console.log("   - [ESSEC (Niveau École)] Program_Discovery : Bloqué (4/3 échecs) — Statut Rouge, bouton Débloquer");
}

main()
  .catch((e) => {
    console.error("❌ Erreur lors du seed :", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
