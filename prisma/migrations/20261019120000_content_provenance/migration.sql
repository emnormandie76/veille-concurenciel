-- Provenance du contenu (plan gestion-contenu, etape 5).
--
-- Decisions du 19 octobre 2026 :
--   * D10 : chaque table de donnees sait qui l'a modifiee en dernier, et quand :
--           "updated_by_id" (cle vers "User"), "updated_at" ; un historique
--           complet viendra plus tard, si l'equipe le demande ;
--   * D11 : et d'ou vient la modification : "updated_via" vaut MANUAL (saisie),
--           AI (donnee validee depuis l'inbox, par l'admin qui en est l'auteur)
--           ou REPORT (signalement, etape 6) ;
--   * D12 : les chiffres cles, les accreditations et les programmes recoivent
--           un lien source ("source_url"), que les tarifs, places, classements
--           et rattachements avaient deja ;
--   * D24 : la cle est en ON DELETE RESTRICT : un compte qui a modifie une
--           donnee ne se supprime pas (il se desactive), son nom reste.
--
-- Additive et facultative partout (piege 5) : rien n'est supprime, renomme ni
-- rendu obligatoire, aucune ligne n'est ecrite. Les lignes existantes restent
-- "non suivies" (trois colonnes vides) : aucune valeur n'est inventee pour
-- elles. Le backend gele lit ces tables (SELECT * de la Phase 2) mais ne
-- compare que les champs qu'il extrait ; il ne les ecrit pas. Ni "PipelineJob"
-- ni "ContributionInbox", qu'il ecrit, ne sont touchees ; ni "ProgramCampus"
-- (une arete sans contenu propre), ni "ProgramPlacement" (aucun chemin
-- d'ecriture).
--
-- Liste de reference des origines : UPDATE_ORIGINS dans lib/provenance.ts
-- (test/provenance-migration.test.ts). Releve prealable du 19 octobre 2026 sur
-- la branche Neon dev : aucune colonne "updated_*" sur ces tables, aucun nom
-- de contrainte en conflit.

-- 1. Le lien source des chiffres cles, des accreditations et des programmes (D12)
ALTER TABLE "SchoolStatsRecord" ADD COLUMN "source_url" TEXT;
ALTER TABLE "AccreditationRecord" ADD COLUMN "source_url" TEXT;
ALTER TABLE "Program" ADD COLUMN "source_url" TEXT;

-- 2. La provenance, sur les neuf tables de donnees (D10, D11, D24)

ALTER TABLE "School"
  ADD COLUMN "updated_at" TIMESTAMP(3),
  ADD COLUMN "updated_by_id" TEXT,
  ADD COLUMN "updated_via" TEXT;
ALTER TABLE "School"
  ADD CONSTRAINT "School_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "School"
  ADD CONSTRAINT "School_updated_via_check"
  CHECK (updated_via IN ('MANUAL', 'AI', 'REPORT'));
ALTER TABLE "School"
  ADD CONSTRAINT "School_provenance_check"
  CHECK ((updated_at IS NULL) = (updated_by_id IS NULL) AND (updated_at IS NULL) = (updated_via IS NULL));

ALTER TABLE "Campus"
  ADD COLUMN "updated_at" TIMESTAMP(3),
  ADD COLUMN "updated_by_id" TEXT,
  ADD COLUMN "updated_via" TEXT;
ALTER TABLE "Campus"
  ADD CONSTRAINT "Campus_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Campus"
  ADD CONSTRAINT "Campus_updated_via_check"
  CHECK (updated_via IN ('MANUAL', 'AI', 'REPORT'));
ALTER TABLE "Campus"
  ADD CONSTRAINT "Campus_provenance_check"
  CHECK ((updated_at IS NULL) = (updated_by_id IS NULL) AND (updated_at IS NULL) = (updated_via IS NULL));

ALTER TABLE "Program"
  ADD COLUMN "updated_at" TIMESTAMP(3),
  ADD COLUMN "updated_by_id" TEXT,
  ADD COLUMN "updated_via" TEXT;
ALTER TABLE "Program"
  ADD CONSTRAINT "Program_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Program"
  ADD CONSTRAINT "Program_updated_via_check"
  CHECK (updated_via IN ('MANUAL', 'AI', 'REPORT'));
ALTER TABLE "Program"
  ADD CONSTRAINT "Program_provenance_check"
  CHECK ((updated_at IS NULL) = (updated_by_id IS NULL) AND (updated_at IS NULL) = (updated_via IS NULL));

ALTER TABLE "PricingRecord"
  ADD COLUMN "updated_at" TIMESTAMP(3),
  ADD COLUMN "updated_by_id" TEXT,
  ADD COLUMN "updated_via" TEXT;
ALTER TABLE "PricingRecord"
  ADD CONSTRAINT "PricingRecord_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PricingRecord"
  ADD CONSTRAINT "PricingRecord_updated_via_check"
  CHECK (updated_via IN ('MANUAL', 'AI', 'REPORT'));
ALTER TABLE "PricingRecord"
  ADD CONSTRAINT "PricingRecord_provenance_check"
  CHECK ((updated_at IS NULL) = (updated_by_id IS NULL) AND (updated_at IS NULL) = (updated_via IS NULL));

ALTER TABLE "CapacityRecord"
  ADD COLUMN "updated_at" TIMESTAMP(3),
  ADD COLUMN "updated_by_id" TEXT,
  ADD COLUMN "updated_via" TEXT;
ALTER TABLE "CapacityRecord"
  ADD CONSTRAINT "CapacityRecord_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CapacityRecord"
  ADD CONSTRAINT "CapacityRecord_updated_via_check"
  CHECK (updated_via IN ('MANUAL', 'AI', 'REPORT'));
ALTER TABLE "CapacityRecord"
  ADD CONSTRAINT "CapacityRecord_provenance_check"
  CHECK ((updated_at IS NULL) = (updated_by_id IS NULL) AND (updated_at IS NULL) = (updated_via IS NULL));

ALTER TABLE "RankingRecord"
  ADD COLUMN "updated_at" TIMESTAMP(3),
  ADD COLUMN "updated_by_id" TEXT,
  ADD COLUMN "updated_via" TEXT;
ALTER TABLE "RankingRecord"
  ADD CONSTRAINT "RankingRecord_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RankingRecord"
  ADD CONSTRAINT "RankingRecord_updated_via_check"
  CHECK (updated_via IN ('MANUAL', 'AI', 'REPORT'));
ALTER TABLE "RankingRecord"
  ADD CONSTRAINT "RankingRecord_provenance_check"
  CHECK ((updated_at IS NULL) = (updated_by_id IS NULL) AND (updated_at IS NULL) = (updated_via IS NULL));

ALTER TABLE "SchoolStatsRecord"
  ADD COLUMN "updated_at" TIMESTAMP(3),
  ADD COLUMN "updated_by_id" TEXT,
  ADD COLUMN "updated_via" TEXT;
ALTER TABLE "SchoolStatsRecord"
  ADD CONSTRAINT "SchoolStatsRecord_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolStatsRecord"
  ADD CONSTRAINT "SchoolStatsRecord_updated_via_check"
  CHECK (updated_via IN ('MANUAL', 'AI', 'REPORT'));
ALTER TABLE "SchoolStatsRecord"
  ADD CONSTRAINT "SchoolStatsRecord_provenance_check"
  CHECK ((updated_at IS NULL) = (updated_by_id IS NULL) AND (updated_at IS NULL) = (updated_via IS NULL));

ALTER TABLE "AccreditationRecord"
  ADD COLUMN "updated_at" TIMESTAMP(3),
  ADD COLUMN "updated_by_id" TEXT,
  ADD COLUMN "updated_via" TEXT;
ALTER TABLE "AccreditationRecord"
  ADD CONSTRAINT "AccreditationRecord_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccreditationRecord"
  ADD CONSTRAINT "AccreditationRecord_updated_via_check"
  CHECK (updated_via IN ('MANUAL', 'AI', 'REPORT'));
ALTER TABLE "AccreditationRecord"
  ADD CONSTRAINT "AccreditationRecord_provenance_check"
  CHECK ((updated_at IS NULL) = (updated_by_id IS NULL) AND (updated_at IS NULL) = (updated_via IS NULL));

ALTER TABLE "ProgramCampusAttachment"
  ADD COLUMN "updated_at" TIMESTAMP(3),
  ADD COLUMN "updated_by_id" TEXT,
  ADD COLUMN "updated_via" TEXT;
ALTER TABLE "ProgramCampusAttachment"
  ADD CONSTRAINT "ProgramCampusAttachment_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProgramCampusAttachment"
  ADD CONSTRAINT "ProgramCampusAttachment_updated_via_check"
  CHECK (updated_via IN ('MANUAL', 'AI', 'REPORT'));
ALTER TABLE "ProgramCampusAttachment"
  ADD CONSTRAINT "ProgramCampusAttachment_provenance_check"
  CHECK ((updated_at IS NULL) = (updated_by_id IS NULL) AND (updated_at IS NULL) = (updated_via IS NULL));
