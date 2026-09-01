-- Migration de rattrapage : refactor Program / ProgramCampus
--
-- Les cinq commits de refactor (`refacto program`, `test refacto bien`,
-- `ajout accreditation performante`, ...) ont modifie schema.prisma sans jamais
-- generer de migration ; la base de developpement a ete alignee par
-- `prisma db push`. Cette migration remet l'historique en phase avec le schema.
--
-- ATTENTION : la version auto-generee par `prisma migrate diff` est destructrice.
-- Elle fait `ALTER TABLE "Program" DROP COLUMN "campusId", ADD COLUMN "schoolId"
-- TEXT NOT NULL` — ce qui echoue sur toute table non vide et detruit le lien
-- programme <-> campus. Ce fichier a ete reecrit a la main pour retro-remplir
-- les nouvelles colonnes avant de supprimer les anciennes.
--
-- Sur une base vierge, tous les UPDATE/INSERT ci-dessous sont des no-op et le
-- resultat est strictement identique a la version auto-generee.

-- ============================================================
-- 1. Ajouts simples (aucune donnee a reprendre)
-- ============================================================

-- AlterTable
ALTER TABLE "AccreditationRecord" ADD COLUMN "accreditation_type" TEXT NOT NULL DEFAULT 'international';

-- AlterTable
ALTER TABLE "ContributionInbox" ADD COLUMN "programCampusId" TEXT;

-- ============================================================
-- 2. Program : campusId -> schoolId
--    L'ecole se deduit du campus auquel le programme etait rattache.
-- ============================================================

-- AlterTable : colonne d'abord nullable, pour permettre le retro-remplissage
ALTER TABLE "Program" ADD COLUMN "schoolId" TEXT;

UPDATE "Program" p
SET "schoolId" = c."schoolId"
FROM "Campus" c
WHERE c."id" = p."campusId";

-- Garde-fou : un programme dont le campus a disparu ne peut pas etre rattache.
DO $$
DECLARE orphelins INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphelins FROM "Program" WHERE "schoolId" IS NULL;
  IF orphelins > 0 THEN
    RAISE EXCEPTION
      'Migration interrompue : % programme(s) sans campus resolvable. Corrigez Program.campusId avant de rejouer.', orphelins;
  END IF;
END $$;

-- Garde-fou : l'unicite passe de (campusId, name) a (schoolId, name).
-- Deux campus d'une meme ecole portant un programme homonyme entraient dans
-- l'ancien modele et se percutent dans le nouveau. Le refactor suppose qu'ils
-- doivent etre fusionnes en un seul Program lie a deux ProgramCampus — arbitrage
-- impossible automatiquement (quel pricing, quel ranking conserver ?).
DO $$
DECLARE doublons INTEGER;
BEGIN
  SELECT COUNT(*) INTO doublons FROM (
    SELECT "schoolId", "name" FROM "Program" GROUP BY "schoolId", "name" HAVING COUNT(*) > 1
  ) d;
  IF doublons > 0 THEN
    RAISE EXCEPTION
      'Migration interrompue : % couple(s) (schoolId, name) en double dans Program. Fusionnez-les manuellement avant de rejouer.', doublons;
  END IF;
END $$;

ALTER TABLE "Program" ALTER COLUMN "schoolId" SET NOT NULL;

-- ============================================================
-- 3. ProgramCampus : table d'association, alimentee depuis Program.campusId
--    Creee AVANT la suppression de Program.campusId, qui en est la source.
-- ============================================================

-- CreateTable
CREATE TABLE "ProgramCampus" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,

    CONSTRAINT "ProgramCampus_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ProgramCampus" ("id", "programId", "campusId")
SELECT gen_random_uuid()::TEXT, p."id", p."campusId"
FROM "Program" p
WHERE p."campusId" IS NOT NULL;

-- ============================================================
-- 4. CapacityRecord : programId -> programCampusId
--    Chaque programme n'avait qu'un campus : la correspondance est unique.
-- ============================================================

ALTER TABLE "CapacityRecord" ADD COLUMN "programCampusId" TEXT;

UPDATE "CapacityRecord" cr
SET "programCampusId" = pc."id"
FROM "ProgramCampus" pc
WHERE pc."programId" = cr."programId";

DO $$
DECLARE orphelins INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphelins FROM "CapacityRecord" WHERE "programCampusId" IS NULL;
  IF orphelins > 0 THEN
    RAISE EXCEPTION
      'Migration interrompue : % CapacityRecord sans ProgramCampus correspondant.', orphelins;
  END IF;
END $$;

ALTER TABLE "CapacityRecord" ALTER COLUMN "programCampusId" SET NOT NULL;

-- ============================================================
-- 5. Retrait des anciennes colonnes, index et cles etrangeres
-- ============================================================

-- DropForeignKey
ALTER TABLE "CapacityRecord" DROP CONSTRAINT "CapacityRecord_programId_fkey";

-- DropIndex
DROP INDEX "CapacityRecord_programId_academic_year_key";

-- AlterTable
ALTER TABLE "CapacityRecord" DROP COLUMN "programId";

-- DropForeignKey
ALTER TABLE "Program" DROP CONSTRAINT "Program_campusId_fkey";

-- DropIndex
DROP INDEX "Program_campusId_name_key";

-- AlterTable
ALTER TABLE "Program" DROP COLUMN "campusId";

-- ============================================================
-- 6. Nouveaux index et cles etrangeres
-- ============================================================

-- CreateIndex
CREATE UNIQUE INDEX "ProgramCampus_programId_campusId_key" ON "ProgramCampus"("programId", "campusId");

-- CreateIndex
CREATE UNIQUE INDEX "CapacityRecord_programCampusId_academic_year_key" ON "CapacityRecord"("programCampusId", "academic_year");

-- CreateIndex
CREATE UNIQUE INDEX "Program_schoolId_name_key" ON "Program"("schoolId", "name");

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramCampus" ADD CONSTRAINT "ProgramCampus_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramCampus" ADD CONSTRAINT "ProgramCampus_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapacityRecord" ADD CONSTRAINT "CapacityRecord_programCampusId_fkey" FOREIGN KEY ("programCampusId") REFERENCES "ProgramCampus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
