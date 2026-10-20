-- Signalements (plan gestion-contenu, etape 6).
--
-- G8 : la contribution du public est abandonnee, remplacee par un formulaire
-- de signalement sans IA. Decisions du 20 octobre 2026 :
--   * D13 : une table a part, "ContentReport", jamais "ContributionInbox" : le
--           traitement gele de l'inbox lit les tickets Pending_AI et paie
--           Tavily et Gemini (piege 6) ;
--   * D35 : message de 10 a 2 000 caracteres (le plafond de 10 envois par heure
--           et par compte vit dans le code) ; reponse du gestionnaire de
--           1 000 caracteres au plus ;
--   * D37 : une ecole supprimee emporte ses signalements (CASCADE, comme toutes
--           ses donnees) ; un campus ou un programme supprime laisse le
--           signalement a l'ecole (SET NULL), avec le nom garde a l'envoi
--           ("target_label") ;
--   * D38 : l'auteur et celui qui traite en ON DELETE RESTRICT, comme les
--           auteurs du contenu (D24) : un tel compte se desactive, il ne se
--           supprime pas.
--
-- Additive : une table neuve, ses index et ses cles. Aucune table existante
-- n'est modifiee, aucune ligne n'est ecrite. Le backend gele ne lit ni n'ecrit
-- cette table.
--
-- Listes et bornes de reference : lib/content-reports.ts
-- (test/content-reports-migration.test.ts). Releve prealable du 20 octobre
-- 2026 sur la branche Neon dev : aucune table, contrainte ni index dont le nom
-- contient "report".

CREATE TABLE "ContentReport" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "campusId" TEXT,
    "programId" TEXT,
    "target_type" TEXT NOT NULL,
    "target_label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "source_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "response" TEXT,
    "handled_by_id" TEXT,
    "handled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentReport_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContentReport_target_type_check" CHECK ("target_type" IN ('SCHOOL', 'CAMPUS', 'PROGRAM')),
    -- Une cible fine a la fois ; une cle passee a vide dit une cible supprimee.
    CONSTRAINT "ContentReport_target_check" CHECK (
        ("target_type" = 'SCHOOL' AND "campusId" IS NULL AND "programId" IS NULL)
        OR ("target_type" = 'CAMPUS' AND "programId" IS NULL)
        OR ("target_type" = 'PROGRAM' AND "campusId" IS NULL)
    ),
    CONSTRAINT "ContentReport_category_check" CHECK ("category" IN ('SCHOOL_INFO', 'CAMPUS_PROGRAM', 'PRICING', 'CAPACITY', 'RANKING', 'STATS', 'ACCREDITATION', 'OTHER')),
    CONSTRAINT "ContentReport_message_check" CHECK (char_length("message") BETWEEN 10 AND 2000),
    CONSTRAINT "ContentReport_status_check" CHECK ("status" IN ('OPEN', 'RESOLVED', 'REJECTED')),
    CONSTRAINT "ContentReport_response_check" CHECK ("response" IS NULL OR char_length("response") <= 1000),
    -- En attente : personne ne l'a traite ; ferme : on sait qui et quand.
    CONSTRAINT "ContentReport_handled_check" CHECK (
        ("status" = 'OPEN' AND "handled_by_id" IS NULL AND "handled_at" IS NULL AND "response" IS NULL)
        OR ("status" <> 'OPEN' AND "handled_by_id" IS NOT NULL AND "handled_at" IS NOT NULL)
    )
);

CREATE INDEX "ContentReport_status_created_at_idx" ON "ContentReport"("status", "created_at");
CREATE INDEX "ContentReport_schoolId_idx" ON "ContentReport"("schoolId");
CREATE INDEX "ContentReport_author_id_idx" ON "ContentReport"("author_id");

ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_handled_by_id_fkey" FOREIGN KEY ("handled_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;
