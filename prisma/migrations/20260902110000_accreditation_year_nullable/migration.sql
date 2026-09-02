-- L'annee d'obtention d'une accreditation devient nullable.
--
-- La colonne etait Int non nullable, et la route de validation ecrivait
-- `year_obtained: item.year_obtained ?? 0` : quand l'annee etait inconnue,
-- l'annee 0 partait en production comme une donnee reelle. Les prompts la
-- demandaient meme explicitement (« mettre 0 si inconnu »).
--
-- « Inconnu » s'ecrit NULL. Les 0 deja ecrits sont convertis : aucune
-- accreditation n'a pu etre obtenue en l'an 0, la valeur ne peut etre qu'un
-- marqueur d'absence.
--
-- AlterTable
ALTER TABLE "AccreditationRecord" ALTER COLUMN "year_obtained" DROP NOT NULL;

-- Backfill : les sentinelles deviennent des NULL.
UPDATE "AccreditationRecord" SET "year_obtained" = NULL WHERE "year_obtained" = 0;
