/**
 * lib/pipeline-history.ts — L'historique des jobs du pipeline, prêt à afficher
 *
 * `GET /api/admin/pipeline-jobs` lit en base les 30 derniers `PipelineJob` et
 * le nombre de contributions `Pending_AI`. Il ne dépend pas du backend : en
 * ligne, c'est tout ce que montre /admin/cron (plan backend-local, étape 5).
 * L'écran (`app/admin/cron/JobHistory.tsx`) affiche ce que décident les
 * fonctions d'ici, sans React ni réseau, pour être testées sans serveur.
 */

/** Une ligne de l'historique, telle que la rend la route. */
export interface PipelineJobRow {
  id: string;
  school_id: string;
  school_name: string;
  phase: string;
  /** "manual" | "rotation" | "cron" (ancien cron, lignes encore en base). */
  source: string;
  /** "queued" | "running" | "completed" | "failed". */
  status: string;
  progress: unknown;
  /** Message d'échec : une Phase 2 y nomme ses cibles ratées. */
  error: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface PipelineJobsResponse {
  jobs: PipelineJobRow[];
  /** Contributions `Pending_AI` : elles attendent le traitement par le backend local. */
  pending_ai: number;
}

/** Longueur de l'aperçu d'une erreur dans la liste ; le texte entier se lit au survol. */
export const ERROR_PREVIEW_LENGTH = 300;

const SOURCE_LABELS: Record<string, string> = {
  manual: "manuelle",
  rotation: "passe due",
  cron: "ancien cron",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export type StatusTone = "pending" | "ok" | "error";

const STATUS_LABELS: Record<string, { label: string; tone: StatusTone }> = {
  queued: { label: "en file", tone: "pending" },
  running: { label: "en cours", tone: "pending" },
  completed: { label: "terminé", tone: "ok" },
  failed: { label: "échec", tone: "error" },
};

export function statusLabel(status: string): { label: string; tone: StatusTone } {
  return STATUS_LABELS[status] ?? { label: status, tone: "pending" };
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** Durée du job : jusqu'à sa fin, ou jusqu'à `nowMs` s'il n'est pas fini. */
export function jobDuration(job: PipelineJobRow, nowMs: number): string {
  const start = Date.parse(job.started_at);
  const end = job.finished_at ? Date.parse(job.finished_at) : nowMs;
  if (Number.isNaN(start) || Number.isNaN(end)) return "—";
  return formatDuration(end - start);
}

/** L'action en cours, que le backend écrit dans `progress.current_action`. */
export function currentAction(progress: unknown): string | null {
  if (progress === null || typeof progress !== "object" || Array.isArray(progress)) return null;
  const action = (progress as Record<string, unknown>).current_action;
  return typeof action === "string" ? action : null;
}

/** L'aperçu d'une erreur, et s'il est tronqué. */
export function errorPreview(error: string | null): { short: string; truncated: boolean } | null {
  if (!error) return null;
  if (error.length <= ERROR_PREVIEW_LENGTH) return { short: error, truncated: false };
  return { short: `${error.slice(0, ERROR_PREVIEW_LENGTH)}…`, truncated: true };
}

/** Le bandeau des contributions en attente du backend local ; `null` s'il n'y en a pas. */
export function describePendingAi(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 contribution attend le traitement par le backend local."
    : `${count} contributions attendent le traitement par le backend local.`;
}
