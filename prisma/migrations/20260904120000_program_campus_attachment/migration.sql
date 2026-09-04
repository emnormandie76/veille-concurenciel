-- Le rattachement programme <-> campus se publie annee par annee.
--
-- ProgramCampus est unique sur (programId, campusId). Les fiches, elles,
-- publient une section « Campus de rattachement » qui donne le lieu ANNEE PAR
-- ANNEE, et qui repete le meme campus sur plusieurs annees. Le Bachelor en
-- Management en 3 ans de l'EM Normandie nomme Le Havre en 1re, en 2e et en 3e
-- annee ; en 3e annee il publie meme deux listes differentes, une par regime :
--
--   1re annee   Le Havre (anglais ou francais) . Paris (francais)
--   2e annee    Le Havre (anglais ou francais) . Paris (francais) . Dublin (anglais)
--   3e annee    INITIAL     Le Havre (francais ou anglais) . Universite partenaire
--               ALTERNANCE  Caen . Le Havre . Paris (francais)
--
-- Une seule ligne (Bachelor, Le Havre) ne peut porter ni les trois annees, ni
-- les deux regimes, ni les langues qui different d'une annee a l'autre.
--
-- Cette migration N'Y TOUCHE PAS. Elle est strictement additive :
--
--   * "ProgramCampus_programId_campusId_key" est conserve tel quel ;
--   * "CapacityRecord" et son unique (programCampusId, academic_year) ne sont
--     pas modifies — c'est le seul chemin valide en production ;
--   * la Phase 2 enumere toujours le meme nombre de ProgramCampus, donc le
--     meme nombre de taches Capacity ;
--   * l'ecran admin continue de presenter un programCampusId comme « un
--     programme sur un campus », ce qu'il reste.
--
-- ZERO ligne dans "ProgramCampusAttachment" = le sens actuel, inchange. Les
-- lignes deja en base gardent donc exactement leur signification, et rien
-- n'est a retro-remplir.

-- ============================================================
-- 1. Le detail annee par annee, en table fille de ProgramCampus
-- ============================================================

CREATE TABLE "ProgramCampusAttachment" (
    "id" TEXT NOT NULL,
    "programCampusId" TEXT NOT NULL,
    "study_year" INTEGER NOT NULL,
    "regime" TEXT NOT NULL DEFAULT 'ANY',
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "source_url" TEXT,

    CONSTRAINT "ProgramCampusAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgramCampusAttachment_programCampusId_study_year_regime_key"
    ON "ProgramCampusAttachment"("programCampusId", "study_year", "regime");

ALTER TABLE "ProgramCampusAttachment"
    ADD CONSTRAINT "ProgramCampusAttachment_programCampusId_fkey"
    FOREIGN KEY ("programCampusId") REFERENCES "ProgramCampus"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 2. Les lieux annonces qui ne sont PAS des campus de l'ecole
--
--    « Universite partenaire », « UniLaSalle Rouen », « Campus de Paris +
--    International », « Lyon, Milan, Londres ». Les creer dans "Campus"
--    ferait entrer chez l'ecole des lieux qui ne lui appartiennent pas.
-- ============================================================

CREATE TABLE "ProgramPlacement" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    -- 0 = annee non precisee. Sentinelle et non NULL : sous PostgreSQL deux
    -- NULL sont distincts, un index unique nullable laisserait entrer deux
    -- fois le meme lieu.
    "study_year" INTEGER NOT NULL DEFAULT 0,
    "regime" TEXT NOT NULL DEFAULT 'ANY',
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'UNSPECIFIED',
    "note" TEXT,
    "source_url" TEXT,

    CONSTRAINT "ProgramPlacement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgramPlacement_programId_study_year_regime_label_key"
    ON "ProgramPlacement"("programId", "study_year", "regime", "label");

ALTER TABLE "ProgramPlacement"
    ADD CONSTRAINT "ProgramPlacement_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "Program"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 3. La contrainte en prose posee au-dessus de la liste par annee
--
--    L'IBBA enumere Paris 1, Dublin 2, Dubai 3, Oxford 4 — puis ouvre par
--    « Paris reste accessible chaque annee, avec au moins une annee
--    obligatoire sur l'un des campus internationaux », ce qui contredit la
--    liste. Conservee en clair pour l'admin qui arbitre ; aucune requete ne
--    s'appuie dessus.
-- ============================================================

ALTER TABLE "Program" ADD COLUMN "campus_policy_note" TEXT;
