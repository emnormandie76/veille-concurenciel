-- ContributionInbox : cles etrangeres et garde-fous d'enumeration.
--
-- 1) RELATIONS
--    schoolId, campusId, programId et programCampusId etaient quatre String?
--    sans relation : rien n'empechait un ticket de referencer une entite
--    supprimee, et l'ecran d'arbitrage affichait alors un rattachement fantome.
--
--    ON DELETE SET NULL, et non CASCADE : la zone tampon est deliberement
--    souple. Supprimer une ecole ne doit pas detruire les contributions qui la
--    visaient ; le ticket se detache, l'admin voit qu'il ne pointe plus sur
--    rien. Les references deja orphelines sont detachees d'abord, sans quoi
--    l'ajout des contraintes echouerait.
--
-- 2) ENUMERATIONS
--    Les statuts et categories circulaient en chaines libres, dupliques entre
--    Python et TypeScript. Une faute de frappe creait un etat inatteignable, en
--    silence : le ticket partait en base avec un statut que plus aucun ecran ni
--    aucune requete ne filtrait.
--
--    Les contraintes sont posees NOT VALID : elles s'appliquent a toute
--    ecriture future sans exiger que les lignes deja presentes soient conformes
--    -- une migration ne doit pas pouvoir echouer sur des donnees historiques.
--    Pour les valider apres verification :
--      ALTER TABLE "ContributionInbox" VALIDATE CONSTRAINT "ContributionInbox_status_check";
--
--    Listes de reference : lib/contribution.ts et backend/constants.py. Ajouter
--    une valeur impose de modifier les deux ET d'ecrire une migration qui
--    remplace la contrainte correspondante.

-- ── 1. Detacher les references orphelines ────────────────────────────────
UPDATE "ContributionInbox" ci
SET "schoolId" = NULL
WHERE ci."schoolId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "School" s WHERE s.id = ci."schoolId");

UPDATE "ContributionInbox" ci
SET "campusId" = NULL
WHERE ci."campusId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Campus" c WHERE c.id = ci."campusId");

UPDATE "ContributionInbox" ci
SET "programId" = NULL
WHERE ci."programId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Program" p WHERE p.id = ci."programId");

UPDATE "ContributionInbox" ci
SET "programCampusId" = NULL
WHERE ci."programCampusId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "ProgramCampus" pc WHERE pc.id = ci."programCampusId");

-- ── 2. Index de rattachement ─────────────────────────────────────────────
-- CreateIndex
CREATE INDEX "ContributionInbox_schoolId_idx" ON "ContributionInbox"("schoolId");

-- CreateIndex
CREATE INDEX "ContributionInbox_programId_idx" ON "ContributionInbox"("programId");

-- ── 3. Cles etrangeres ───────────────────────────────────────────────────
-- AddForeignKey
ALTER TABLE "ContributionInbox" ADD CONSTRAINT "ContributionInbox_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionInbox" ADD CONSTRAINT "ContributionInbox_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionInbox" ADD CONSTRAINT "ContributionInbox_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionInbox" ADD CONSTRAINT "ContributionInbox_programCampusId_fkey" FOREIGN KEY ("programCampusId") REFERENCES "ProgramCampus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 4. Garde-fous d'enumeration ──────────────────────────────────────────
ALTER TABLE "ContributionInbox"
  ADD CONSTRAINT "ContributionInbox_status_check"
  CHECK (status IN ('Pending_AI', 'Pending_Admin', 'Validated', 'Rejected', 'Failed'))
  NOT VALID;

ALTER TABLE "ContributionInbox"
  ADD CONSTRAINT "ContributionInbox_ai_category_check"
  CHECK (ai_category IN ('Program_Discovery', 'Pricing', 'Ranking', 'Capacity', 'SchoolStats', 'Accreditation'))
  NOT VALID;

ALTER TABLE "ContributionInbox"
  ADD CONSTRAINT "ContributionInbox_source_type_check"
  CHECK (source_type IN ('User_Submission', 'Automated_AI'))
  NOT VALID;

-- User.role suivait la meme regle non ecrite (ADMIN | MODERATOR) sans que rien
-- ne l'empeche de valoir autre chose.
ALTER TABLE "User"
  ADD CONSTRAINT "User_role_check"
  CHECK (role IN ('ADMIN', 'MODERATOR'))
  NOT VALID;

-- Le statut d'un job du pipeline obeit a la meme logique.
ALTER TABLE "PipelineJob"
  ADD CONSTRAINT "PipelineJob_status_check"
  CHECK (status IN ('queued', 'running', 'completed', 'failed'))
  NOT VALID;
