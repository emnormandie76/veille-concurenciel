-- Admissions d'un programme (plan gestion-contenu, etape 8).
--
-- Doc "Plan d'evolution" : "Annee d'entree d'un programme : avec quel diplome
-- on peut y entrer". Decisions du 20 octobre 2026 :
--   * D16 : une table fille, "ProgramEntry" : une ligne par entree possible
--           (post-bac en 1re annee, Bac+2 en 3e annee...). "Program" n'est pas
--           touchee ;
--   * D47 : "Program"."admission_exam" (le concours, en texte libre) reste tel
--           quel ; les entrees le completent ;
--   * D48 : des listes fermees : annee d'entree de 1 a 5, niveau requis de 0
--           (Bac) a 5 (Bac+5), voie parmi cinq valeurs, note de 500 caracteres
--           au plus ;
--   * D49 : la provenance des neuf tables de donnees (etape 5) : l'auteur (cle
--           ON DELETE RESTRICT vers "User", D24), la date, l'origine, et un
--           lien source ;
--   * D52 : une 9e categorie de signalement, ADMISSIONS : la contrainte
--           "ContentReport_category_check" est remplacee. La migration de
--           l'etape 6 n'est pas touchee ; les lignes existantes tiennent la
--           nouvelle liste, qui ne fait qu'ajouter une valeur.
--
-- Additive : une table neuve, son index unique et ses deux cles ; la seule
-- table existante touchee est "ContentReport" (une contrainte elargie), que le
-- backend gele ne lit ni n'ecrit. Aucune ligne n'est ecrite.
--
-- Listes et bornes de reference : lib/program-entries.ts et
-- lib/content-reports.ts (test/program-entries-migration.test.ts). Releve
-- prealable du 20 octobre 2026 sur la branche Neon dev : aucune table,
-- contrainte ni index dont le nom evoque une entree.

-- 1. Les entrees d'un programme (D16, D48, D49)
CREATE TABLE "ProgramEntry" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "entry_year" INTEGER NOT NULL,
    "required_level" INTEGER NOT NULL,
    "route" TEXT NOT NULL DEFAULT 'UNSPECIFIED',
    "note" TEXT,
    "source_url" TEXT,
    "updated_at" TIMESTAMP(3),
    "updated_by_id" TEXT,
    "updated_via" TEXT,

    CONSTRAINT "ProgramEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProgramEntry_entry_year_check" CHECK ("entry_year" BETWEEN 1 AND 5),
    CONSTRAINT "ProgramEntry_required_level_check" CHECK ("required_level" BETWEEN 0 AND 5),
    CONSTRAINT "ProgramEntry_route_check" CHECK ("route" IN ('PARCOURSUP', 'EXAM', 'TITLE', 'INTERNATIONAL', 'UNSPECIFIED')),
    CONSTRAINT "ProgramEntry_note_check" CHECK ("note" IS NULL OR char_length("note") <= 500),
    -- La provenance, comme sur les neuf tables de l'etape 5.
    CONSTRAINT "ProgramEntry_updated_via_check" CHECK (updated_via IN ('MANUAL', 'AI', 'REPORT')),
    CONSTRAINT "ProgramEntry_provenance_check" CHECK ((updated_at IS NULL) = (updated_by_id IS NULL) AND (updated_at IS NULL) = (updated_via IS NULL))
);

-- Une entree par annee, niveau et voie dans un programme ; l'index sert aussi
-- la lecture par programme.
CREATE UNIQUE INDEX "ProgramEntry_programId_entry_year_required_level_route_key" ON "ProgramEntry"("programId", "entry_year", "required_level", "route");

ALTER TABLE "ProgramEntry" ADD CONSTRAINT "ProgramEntry_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgramEntry" ADD CONSTRAINT "ProgramEntry_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Une 9e categorie de signalement, ADMISSIONS (D52)
ALTER TABLE "ContentReport" DROP CONSTRAINT "ContentReport_category_check";
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_category_check" CHECK ("category" IN ('SCHOOL_INFO', 'CAMPUS_PROGRAM', 'ADMISSIONS', 'PRICING', 'CAPACITY', 'RANKING', 'STATS', 'ACCREDITATION', 'OTHER'));
