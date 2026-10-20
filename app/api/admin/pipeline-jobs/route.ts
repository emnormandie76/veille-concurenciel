/**
 * GET /api/admin/pipeline-jobs
 *
 * L'historique de /admin/cron, lu en base par Prisma seul : il s'affiche aussi
 * en ligne, où le backend n'existe pas (plan backend-local, étape 5). Lecture :
 * ADMIN seulement (`guardAdmin`, plan gestion-contenu, étape 1 : l'IA est
 * réservée à l'admin).
 *
 * - `jobs` : les 30 derniers `PipelineJob`, du plus récent au plus ancien,
 *   avec le nom de l'école. `error` (borné à 2 000 caractères, comme à
 *   l'écriture par le backend) nomme, pour une Phase 2 en échec, ses cibles
 *   ratées : l'écran l'affiche (décision du propriétaire du 14 octobre 2026) ;
 * - `pending_ai` : les contributions `Pending_AI`, qui attendent le
 *   traitement par le backend local.
 *
 * Plan gestion-contenu, étape 7 : chaque job porte `triggered_by`, le nom
 * affiché de qui l'a lancé (D25 : le nom seul, ni identifiant ni adresse),
 * lu dans le journal `ResearchLaunch` (D14) : une recherche ciblée par l'id de
 * son job, une passe due par la fenêtre de son lancement (D40) ; `null` pour
 * un job sans lancement connu, que l'écran dit « non suivi » (D44).
 */

import { NextResponse } from "next/server";
import { guardAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { STATUS_PENDING_AI } from "@/lib/contribution";
import { readLaunchers } from "@/lib/research-launch-log";

const HISTORY_SIZE = 30;
const ERROR_MAX_LENGTH = 2000;

const iso = (date: Date | null) => (date ? date.toISOString() : null);

export async function GET() {
  const { error } = await guardAdmin();
  if (error) return error;

  try {
    const [jobs, pendingAi] = await Promise.all([
      prisma.pipelineJob.findMany({
        orderBy: { started_at: "desc" },
        take: HISTORY_SIZE,
        select: {
          id: true,
          schoolId: true,
          phase: true,
          source: true,
          status: true,
          progress: true,
          error: true,
          started_at: true,
          updated_at: true,
          finished_at: true,
          school: { select: { name: true } },
        },
      }),
      prisma.contributionInbox.count({ where: { status: STATUS_PENDING_AI } }),
    ]);
    const launchers = await readLaunchers(jobs);

    return NextResponse.json({
      jobs: jobs.map((job) => ({
        id: job.id,
        school_id: job.schoolId,
        school_name: job.school.name,
        phase: job.phase,
        source: job.source,
        status: job.status,
        progress: job.progress,
        error: job.error ? job.error.slice(0, ERROR_MAX_LENGTH) : null,
        started_at: iso(job.started_at),
        updated_at: iso(job.updated_at),
        finished_at: iso(job.finished_at),
        triggered_by: launchers.get(job.id) ?? null,
      })),
      pending_ai: pendingAi,
    });
  } catch (err) {
    console.error("[pipeline-jobs] Lecture de l'historique impossible :", err);
    return NextResponse.json(
      { error: "Lecture de l'historique des jobs impossible." },
      { status: 500 }
    );
  }
}
