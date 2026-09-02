-- Etat d'avancement du pipeline, en base.
--
-- L'etat des jobs vivait dans _pipeline_jobs et _pipeline_progress, deux
-- dictionnaires de module de backend/routers/internal.py. Trois consequences :
--   1. un redemarrage du processus (Koyeb EcoFree en redemarre) laissait un job
--      "running" disparaitre sans jamais passer a "failed" -- et comme les
--      points d'entree refusent de lancer un scan quand un job tourne deja sur
--      l'ecole, l'ecole restait verrouillee sans que rien ne l'indique ;
--   2. _pipeline_jobs n'etait jamais purge : chaque recherche ciblee y creait
--      une cle qui ne repartait plus ;
--   3. l'etat n'etait pas consultable en dehors du processus.
--
-- La purge devient un DELETE date, le verrouillage fantome devient detectable
-- (updated_at trop ancien -> job repute mort), et l'etat survit au redemarrage.
--
-- CreateTable
CREATE TABLE "PipelineJob" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "worker_id" TEXT,
    "progress" JSONB,
    "result" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "PipelineJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Garde de concurrence : "un job actif existe-t-il pour cette ecole ?"
CREATE INDEX "PipelineJob_schoolId_status_idx" ON "PipelineJob"("schoolId", "status");

-- CreateIndex
-- Detection des jobs morts et purge des jobs termines.
CREATE INDEX "PipelineJob_status_updated_at_idx" ON "PipelineJob"("status", "updated_at");

-- AddForeignKey
ALTER TABLE "PipelineJob" ADD CONSTRAINT "PipelineJob_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
