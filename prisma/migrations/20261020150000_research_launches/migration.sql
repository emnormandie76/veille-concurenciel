-- Journal des lancements de l'IA (plan gestion-contenu, etape 7).
--
-- L'historique de /admin/cron doit dire qui a lance chaque recherche.
-- Decisions du 20 octobre 2026 :
--   * D14 : un journal tenu par Next.js seul, dans une table neuve.
--           "PipelineJob", que le backend gele ecrit, n'est pas touchee : ni
--           colonne, ni cle vers elle (le backend purge ses jobs, et une cle
--           bloquerait sa purge) ;
--   * D40 : les passes dues ne rendent aucun id de job ; leurs jobs
--           "rotation" reviennent au lancement qui les precede, au plus
--           "max_passes" (1 a 5), jusqu'au lancement suivant qui a pu partir.
--           D'ou "launched_at" a l'heure de la base, comme
--           "PipelineJob"."started_at" que le backend ecrit par now() ;
--   * D41 : le lancement s'ecrit avant l'appel au backend ("PENDING"), puis
--           son issue : parti ("STARTED"), pas parti ("NOT_STARTED"), ou
--           inconnu ("UNKNOWN" : delai depasse, reponse illisible) ;
--   * D42 : le lanceur en ON DELETE RESTRICT, comme les auteurs du contenu
--           (D24) et des signalements (D38) : un tel compte se desactive, il
--           ne se supprime pas.
--
-- Additive : une table neuve, ses index et sa cle. Aucune table existante
-- n'est modifiee, aucune ligne n'est ecrite. Le backend gele ne lit ni n'ecrit
-- cette table.
--
-- Listes et bornes de reference : lib/research-launches.ts et
-- lib/rotation-status.ts (test/research-launches-migration.test.ts). Releve
-- prealable du 20 octobre 2026 sur la branche Neon dev : aucune table,
-- contrainte ni index dont le nom contient "launch".

CREATE TABLE "ResearchLaunch" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "triggered_by_id" TEXT NOT NULL,
    "launched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "request" JSONB NOT NULL,
    "max_passes" INTEGER,
    "job_id" TEXT,
    "http_status" INTEGER,
    "detail" TEXT,

    CONSTRAINT "ResearchLaunch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchLaunch_kind_check" CHECK ("kind" IN ('TARGETED', 'DUE_PASSES')),
    CONSTRAINT "ResearchLaunch_status_check" CHECK ("status" IN ('PENDING', 'STARTED', 'NOT_STARTED', 'UNKNOWN')),
    -- Le nombre de passes n'existe que pour les passes dues.
    CONSTRAINT "ResearchLaunch_max_passes_check" CHECK (
        ("kind" = 'DUE_PASSES' AND "max_passes" BETWEEN 1 AND 5)
        OR ("kind" = 'TARGETED' AND "max_passes" IS NULL)
    ),
    -- Une recherche ciblee partie porte l'id de son job ; les passes dues n'en ont pas.
    CONSTRAINT "ResearchLaunch_job_check" CHECK (
        ("kind" = 'DUE_PASSES' AND "job_id" IS NULL)
        OR ("kind" = 'TARGETED' AND ("status" <> 'STARTED' OR "job_id" IS NOT NULL))
    ),
    -- En attente : pas encore de reponse ; sinon, son code HTTP.
    CONSTRAINT "ResearchLaunch_answer_check" CHECK (
        ("status" = 'PENDING' AND "http_status" IS NULL AND "job_id" IS NULL AND "detail" IS NULL)
        OR ("status" <> 'PENDING' AND "http_status" BETWEEN 100 AND 599)
    ),
    CONSTRAINT "ResearchLaunch_detail_check" CHECK ("detail" IS NULL OR char_length("detail") <= 1000)
);

CREATE INDEX "ResearchLaunch_kind_launched_at_idx" ON "ResearchLaunch"("kind", "launched_at");
CREATE INDEX "ResearchLaunch_job_id_idx" ON "ResearchLaunch"("job_id");

ALTER TABLE "ResearchLaunch" ADD CONSTRAINT "ResearchLaunch_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
