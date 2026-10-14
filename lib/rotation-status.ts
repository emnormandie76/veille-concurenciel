/**
 * lib/rotation-status.ts — Les passes dues, prêtes à afficher et à lancer
 *
 * `GET /internal/pipeline-status` porte, sous `scheduler.rotation`, les passes
 * dues et ce qu'elles ont coûté (`_rotation_status()` dans
 * backend/scheduler/jobs.py). Il n'y a plus de cron (plan backend-local,
 * étape 3) : ni nuit, ni heure, ni fuseau. L'admin lance les passes dues
 * depuis /admin/cron, par `POST /api/admin/run-due-passes`, sous le plafond
 * mensuel, après une synchro `/usage` des crédits.
 *
 * Le panneau `app/admin/cron/RotationPanel.tsx` affiche le bloc ; les
 * décisions d'affichage, le corps de la demande et la lecture de son rapport
 * vivent ici, sans React ni réseau, pour être testés sans serveur.
 *
 * Les crédits sont des ESTIMATIONS, comptées sur le mois calendaire UTC par le
 * gestionnaire de clés du backend : ils repartent de zéro à chaque démarrage
 * jusqu'à la synchro `/usage` (`usage_sync`).
 */

export type RotationReason = "never" | "interval" | "retry_after_failure";

export interface RotationCandidate {
  school_name: string;
  phase: "1" | "2";
  reason: RotationReason;
  last_pass_at: string | null;
  estimated_credits: number;
}

/** Dernière exécution réelle des passes dues, depuis le démarrage du backend. */
export interface RotationLastRun {
  status: "success" | "failed";
  detail: string | null;
  finished_at: string;
}

/** Dernière synchro `/usage` de toutes les clés Tavily (suffixes de clés seulement). */
export interface UsageSync {
  ok: boolean;
  at: string;
  failed_keys: string[];
}

export interface RotationStatus {
  interval_days: number;
  monthly_ceiling: number;
  month_credits_used: number | null;
  due_count: number;
  next: RotationCandidate[];
  last_run: RotationLastRun | null;
  usage_sync: UsageSync | null;
}

export type RotationBlock = RotationStatus | { error: string };

/** Passes lancées par une demande, au plus (`MAX_PASSES_PER_RUN` du backend). */
export const MAX_PASSES_PER_RUN = 5;

export const REASON_LABELS: Record<RotationReason, string> = {
  never: "Jamais passée",
  interval: "Intervalle écoulé",
  retry_after_failure: "Reprise après échec",
};

export function isRotationError(block: RotationBlock): block is { error: string } {
  return "error" in block;
}

export type RotationMode = "on_demand" | "ceiling_zero";

/** Sur demande ; ou plafond à 0, où aucune passe ne tient et seule la simulation sert. */
export function rotationMode(rotation: RotationStatus): RotationMode {
  return rotation.monthly_ceiling === 0 ? "ceiling_zero" : "on_demand";
}

export function describeRotation(rotation: RotationStatus): string {
  const rhythm = `retour tous les ${rotation.interval_days} jours`;
  if (rotationMode(rotation) === "ceiling_zero") {
    return `Plafond à 0 — aucune passe ne tient : seule la simulation sert (${rhythm})`;
  }
  return `Sur demande — ${rhythm}, plafond de ${rotation.monthly_ceiling} crédits par mois`;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Les crédits du mois sont-ils recalés sur Tavily ? Le backend en mémoire
 * repart de zéro à chaque démarrage ; une passe réelle refait la synchro
 * d'abord et ne part pas si elle échoue (backend, `UsageSyncFailed`).
 */
export function describeUsageSync(sync: UsageSync | null): { tone: "ok" | "warning"; text: string } {
  if (sync === null) {
    return {
      tone: "warning",
      text:
        "Crédits du mois non recalés sur Tavily : aucune synchro /usage terminée depuis le " +
        "démarrage du backend. Une passe réelle la refait d'abord.",
    };
  }
  if (sync.ok) {
    return { tone: "ok", text: `Crédits recalés sur Tavily (synchro /usage du ${formatDateTime(sync.at)})` };
  }
  const keys = sync.failed_keys.join(", ") || "clé inconnue";
  return {
    tone: "warning",
    text:
      `Dernière synchro /usage en échec (${keys}) : les crédits affichés peuvent être sous-estimés. ` +
      "Une passe réelle refait la synchro et ne part pas si elle échoue encore.",
  };
}

/** Crédits du mois sur le plafond ; `null` si le backend n'a pas de clés. */
export function ceilingUsage(rotation: RotationStatus): { used: number; ceiling: number; pct: number } | null {
  if (rotation.month_credits_used === null) return null;
  const { month_credits_used: used, monthly_ceiling: ceiling } = rotation;
  const pct = ceiling > 0 ? Math.min(100, (used / ceiling) * 100) : 100;
  return { used, ceiling, pct };
}

/**
 * La passe tiendrait-elle sous le plafond maintenant ? La même règle que le
 * backend : crédits du mois + estimation ≤ plafond. `null` si les crédits sont
 * inconnus.
 */
export function fitsUnderCeiling(candidate: RotationCandidate, rotation: RotationStatus): boolean | null {
  if (rotation.month_credits_used === null) return null;
  return rotation.month_credits_used + candidate.estimated_credits <= rotation.monthly_ceiling;
}

/**
 * Ce que lancerait une demande de `maxPasses` passes, pour la confirmation :
 * la sélection du backend (`_select_passes`), dans l'ordre, chaque passe
 * retenue comptée à son estimation. Faite sur les passes affichées (`next`,
 * les 5 premières dues) : c'est un aperçu, le backend replanifie au départ.
 * `null` si les crédits sont inconnus.
 */
export function previewRun(
  rotation: RotationStatus,
  maxPasses: number,
): { passes: RotationCandidate[]; credits: number } | null {
  if (rotation.month_credits_used === null) return null;
  let used = rotation.month_credits_used;
  const passes: RotationCandidate[] = [];
  for (const candidate of rotation.next) {
    if (passes.length >= maxPasses) break;
    if (used + candidate.estimated_credits > rotation.monthly_ceiling) continue;
    passes.push(candidate);
    used += candidate.estimated_credits;
  }
  return { passes, credits: passes.reduce((sum, c) => sum + c.estimated_credits, 0) };
}

/** « Em Lyon, Phase 2, ~785 crédits », comme le journal du backend. */
export function describeCandidate(candidate: RotationCandidate): string {
  return `${candidate.school_name}, Phase ${candidate.phase}, ~${candidate.estimated_credits} crédits`;
}

export function formatPassDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

// ── La demande : POST /api/admin/run-due-passes ───────────────────

export interface RunDuePassesForward {
  max_passes: number;
  dry_run: boolean;
}

export type ParsedRunDuePasses =
  | { ok: true; forward: RunDuePassesForward }
  | { ok: false; error: string };

const RUN_DUE_PASSES_FIELDS = ["max_passes", "dry_run"];

/**
 * Relit le corps reçu par la route, avec les règles du backend
 * (`RunDuePassesRequest`) : `dry_run` exigé et vrai booléen, `max_passes`
 * entier de 1 à 5 (1 s'il est absent), aucun autre champ. Une passe payante ne
 * part jamais par défaut, ni sur `"false"`, ni sur une faute de frappe
 * (`dryRun`) qui laisserait `dry_run` de côté.
 */
export function parseRunDuePassesBody(body: unknown): ParsedRunDuePasses {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Le corps doit être un objet JSON : { max_passes, dry_run }" };
  }
  const input = body as Record<string, unknown>;

  const unknown = Object.keys(input).filter((key) => !RUN_DUE_PASSES_FIELDS.includes(key));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Champ inconnu : ${unknown.join(", ")} (attendus : max_passes, dry_run)`,
    };
  }
  if (typeof input.dry_run !== "boolean") {
    return { ok: false, error: "dry_run est exigé, et doit valoir true ou false (booléen JSON)" };
  }
  const maxPasses = input.max_passes === undefined ? 1 : input.max_passes;
  if (
    typeof maxPasses !== "number" ||
    !Number.isInteger(maxPasses) ||
    maxPasses < 1 ||
    maxPasses > MAX_PASSES_PER_RUN
  ) {
    return { ok: false, error: `max_passes doit être un entier de 1 à ${MAX_PASSES_PER_RUN}` };
  }
  return { ok: true, forward: { max_passes: maxPasses, dry_run: input.dry_run } };
}

// ── Le rapport rendu par le backend ───────────────────────────────

export interface LaunchedPass extends RotationCandidate {
  status: string;
  error: string | null;
}

/** Rapport de `run_due_passes` (architecture.md §2.3). */
export interface DuePassesReport {
  dry_run: boolean;
  max_passes: number;
  /** `planned` dans la réponse 202 ; sinon l'issue finale. */
  status: "planned" | "success" | "failed";
  detail: string | null;
  monthly_ceiling: number;
  month_credits_used: number | null;
  due_count: number;
  planned: RotationCandidate[];
  launched: LaunchedPass[];
  usage_sync: UsageSync | null;
}

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

/**
 * Ce que l'écran dit d'une réponse 200 (simulation) ou 202 (passe réelle).
 * Une 202 sans passe au départ porte le rapport final : rien de dû, plafond
 * atteint, ou planification impossible.
 */
export function describeDuePassesReport(report: DuePassesReport): { tone: "success" | "info" | "error"; text: string } {
  const detail = (report.detail ?? "").replace(/^simulation : /, "") || "—";
  const list = report.planned.map(describeCandidate).join(" ; ");
  const n = report.planned.length;

  if (report.dry_run) {
    if (report.status === "failed") return { tone: "error", text: `Simulation impossible — ${detail}` };
    if (n > 0) {
      return {
        tone: "info",
        text: `Simulation : ${n} ${plural(n, "passe partirait", "passes partiraient")} — ${list}`,
      };
    }
    return { tone: "info", text: `Simulation : ${detail}` };
  }

  if (report.status === "planned" && n > 0) {
    return { tone: "success", text: `${n} ${plural(n, "passe lancée", "passes lancées")} : ${list}` };
  }
  return { tone: report.status === "failed" ? "error" : "info", text: `Aucune passe lancée — ${detail}` };
}
