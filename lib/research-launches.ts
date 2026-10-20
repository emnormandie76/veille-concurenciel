/**
 * lib/research-launches.ts — Les règles du journal des lancements de l'IA
 *
 * Plan gestion-contenu, étape 7 : l'historique de /admin/cron dit qui a lancé
 * chaque recherche. Next.js tient pour cela un journal, `ResearchLaunch`
 * (D14) ; le backend gelé ne le connaît pas, et `PipelineJob`, la table qu'il
 * écrit, n'est pas touchée.
 *
 * - **L'issue** d'un lancement (D41) : il s'écrit « en attente » avant l'appel
 *   au backend, puis devient parti (`STARTED`), pas parti (`NOT_STARTED` : le
 *   backend a refusé, n'avait rien à lancer, ou n'a rien reçu), ou inconnu
 *   (`UNKNOWN` : délai dépassé, réponse illisible ; la demande a pu partir).
 * - **Le lanceur d'un job** : une recherche ciblée par l'id de son job, que le
 *   backend rend ; une passe due par la **fenêtre** de son lancement (D40),
 *   puisque la réponse 202 ne porte aucun id de job et que les jobs
 *   `rotation` naissent après elle, un par un. Les jobs créés après un
 *   lancement qui a pu partir, jusqu'au suivant, lui reviennent, au plus N
 *   (le nombre de passes demandé). Le verrou du backend (409 si une exécution
 *   réelle tourne déjà) empêche deux exécutions de se mêler. Un job hors
 *   fenêtre (appel direct au backend avec le jeton, ancien cron) reste sans
 *   lanceur : « non suivi » (D44).
 *
 * Sans React, sans base ni réseau : testé par test/research-launches.test.ts.
 * L'écriture et la lecture en base sont dans lib/research-launch-log.ts.
 */

import { describeBackendError } from "./backend-state";
import type { BackendResult } from "./internal-api";

/** Ce qui a été lancé. Une simulation des passes dues ne s'écrit pas. */
export const LAUNCH_KINDS = ["TARGETED", "DUE_PASSES"] as const;
export type LaunchKind = (typeof LAUNCH_KINDS)[number];

/** L'issue d'un lancement (D41). */
export const LAUNCH_STATUSES = ["PENDING", "STARTED", "NOT_STARTED", "UNKNOWN"] as const;
export type LaunchStatus = (typeof LAUNCH_STATUSES)[number];

/** Le message gardé avec l'issue (contrainte `ResearchLaunch_detail_check`). */
export const LAUNCH_DETAIL_MAX_LENGTH = 1000;

/** `PipelineJob.source` : une recherche lancée depuis l'écran, une passe due. */
export const JOB_SOURCE_MANUAL = "manual";
export const JOB_SOURCE_ROTATION = "rotation";

export interface LaunchOutcome {
  status: LaunchStatus;
  http_status: number;
  job_id: string | null;
  detail: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Borné à `LAUNCH_DETAIL_MAX_LENGTH` caractères, comptés comme `char_length` de Postgres. */
function bounded(text: unknown): string | null {
  if (typeof text !== "string" || !text) return null;
  const chars = Array.from(text);
  return chars.length > LAUNCH_DETAIL_MAX_LENGTH ? chars.slice(0, LAUNCH_DETAIL_MAX_LENGTH).join("") : text;
}

/**
 * L'issue d'un lancement, d'après ce que l'appel au backend a donné.
 *
 * - Le backend n'a pas répondu dans le délai, ou illisiblement : la demande a
 *   pu partir, l'issue est inconnue. Il n'était pas joignable : rien n'est
 *   parti.
 * - Il a refusé (4xx, 5xx) : rien n'est parti.
 * - Recherche ciblée acceptée : partie, avec l'id du job ; sans id, inconnue.
 * - Passes dues acceptées : parties si le rapport dit `planned` ; un rapport
 *   final (rien de dû, plafond atteint, planification impossible) ne lance rien.
 */
export function launchOutcome(kind: LaunchKind, result: BackendResult): LaunchOutcome {
  const http_status = result.status;

  if (result.kind === "failed") {
    const status = result.code === "BACKEND_TIMEOUT" || result.code === "BACKEND_BAD_RESPONSE" ? "UNKNOWN" : "NOT_STARTED";
    return { status, http_status, job_id: null, detail: bounded(`${result.code} : ${result.error}`) };
  }

  if (result.status < 200 || result.status >= 300) {
    return { status: "NOT_STARTED", http_status, job_id: null, detail: bounded(describeBackendError(result.status, result.data)) };
  }

  const body = asRecord(result.data);
  if (kind === "TARGETED") {
    const jobId = body?.job_id;
    if (typeof jobId === "string" && jobId) {
      return { status: "STARTED", http_status, job_id: jobId, detail: bounded(body?.message) };
    }
    return { status: "UNKNOWN", http_status, job_id: null, detail: "Réponse du backend sans id de job." };
  }

  return {
    status: body?.status === "planned" ? "STARTED" : "NOT_STARTED",
    http_status,
    job_id: null,
    detail: bounded(body?.detail),
  };
}

/** Vrai si le lancement a pu lancer quelque chose : il ouvre une fenêtre (D40). */
export function mayHaveStarted(status: LaunchStatus): boolean {
  return status !== "NOT_STARTED";
}

/** Un lancement de passes dues qui a pu partir, et son lanceur (le nom affiché). */
export interface DuePassWindow {
  launched_at: Date;
  max_passes: number;
  launcher: string;
}

/**
 * Le lanceur des jobs `rotation` (D40) : chaque lancement reçoit les jobs nés
 * à partir de son heure et avant le lancement suivant, au plus `max_passes`,
 * dans l'ordre. Rend `id du job → lanceur` ; un job hors de toute fenêtre n'a
 * pas d'entrée.
 */
export function attributeDuePasses(
  jobs: ReadonlyArray<{ id: string; started_at: Date }>,
  windows: ReadonlyArray<DuePassWindow>
): Map<string, string> {
  const owners = new Map<string, string>();
  const byTime = [...jobs].sort((a, b) => a.started_at.getTime() - b.started_at.getTime() || a.id.localeCompare(b.id));
  const ordered = [...windows].sort((a, b) => a.launched_at.getTime() - b.launched_at.getTime());

  ordered.forEach((window, index) => {
    const start = window.launched_at.getTime();
    const end = ordered[index + 1]?.launched_at.getTime() ?? Infinity;
    byTime
      .filter((job) => job.started_at.getTime() >= start && job.started_at.getTime() < end)
      .slice(0, window.max_passes)
      .forEach((job) => owners.set(job.id, window.launcher));
  });
  return owners;
}
