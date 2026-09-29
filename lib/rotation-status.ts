/**
 * lib/rotation-status.ts — Le bloc `rotation` de pipeline-status, prêt à afficher
 *
 * `GET /internal/pipeline-status` porte, sous `scheduler.rotation`, ce que la
 * rotation nocturne des recherches va faire et ce qu'elle a coûté
 * (`_rotation_status()` dans backend/scheduler/jobs.py). Le panneau
 * `app/admin/cron/RotationPanel.tsx` l'affiche ; les décisions d'affichage
 * vivent ici, sans React ni réseau, pour être testées sans serveur.
 *
 * Les crédits sont des ESTIMATIONS, comptées sur le mois calendaire UTC par le
 * gestionnaire de clés du backend : ils repartent de zéro à chaque redémarrage
 * jusqu'à la synchronisation avec Tavily.
 */

export type RotationReason = "never" | "interval" | "retry_after_failure";

export interface RotationCandidate {
  school_name: string;
  phase: "1" | "2";
  reason: RotationReason;
  last_pass_at: string | null;
  estimated_credits: number;
}

export interface RotationLastNight {
  status: "success" | "failed";
  detail: string | null;
  finished_at: string;
}

export interface RotationStatus {
  enabled: boolean;
  hour: number;
  timezone: string;
  interval_days: number;
  passes_per_night: number;
  monthly_ceiling: number;
  month_credits_used: number | null;
  due_count: number;
  next: RotationCandidate[];
  last_night: RotationLastNight | null;
}

export type RotationBlock = RotationStatus | { error: string };

export interface ResearchCron {
  enabled: boolean;
  reason: string;
}

export const REASON_LABELS: Record<RotationReason, string> = {
  never: "Jamais passée",
  interval: "Intervalle écoulé",
  retry_after_failure: "Reprise après échec",
};

export function isRotationError(block: RotationBlock): block is { error: string } {
  return "error" in block;
}

export type RotationMode = "active" | "dry_run" | "inactive";

/**
 * Active, à blanc (plafond 0 : planifie et journalise sans rien dépenser), ou
 * inactive — hors production, la raison vient de `research_cron`.
 */
export function rotationMode(rotation: RotationStatus): RotationMode {
  if (!rotation.enabled) return "inactive";
  return rotation.monthly_ceiling === 0 ? "dry_run" : "active";
}

export function describeRotation(rotation: RotationStatus, researchCron?: ResearchCron): string {
  const passes = rotation.passes_per_night > 1 ? `${rotation.passes_per_night} passes` : "une passe";
  const schedule = `chaque nuit à ${rotation.hour} h (${rotation.timezone}), ${passes} au plus, retour tous les ${rotation.interval_days} jours`;
  switch (rotationMode(rotation)) {
    case "active":
      return `Active — ${schedule}`;
    case "dry_run":
      return `À blanc — plafond à 0 : la rotation planifie et journalise sans rien dépenser (${schedule})`;
    case "inactive":
      return `Inactive — ${researchCron?.reason ?? "job non inscrit"}`;
  }
}

/** Crédits du mois sur le plafond du cron ; `null` si le backend n'a pas de clés. */
export function ceilingUsage(rotation: RotationStatus): { used: number; ceiling: number; pct: number } | null {
  if (rotation.month_credits_used === null) return null;
  const { month_credits_used: used, monthly_ceiling: ceiling } = rotation;
  const pct = ceiling > 0 ? Math.min(100, (used / ceiling) * 100) : 100;
  return { used, ceiling, pct };
}

/**
 * La passe tiendrait-elle sous le plafond ce soir ? La même règle que le job :
 * crédits du mois + estimation ≤ plafond. `null` si les crédits sont inconnus.
 */
export function fitsUnderCeiling(candidate: RotationCandidate, rotation: RotationStatus): boolean | null {
  if (rotation.month_credits_used === null) return null;
  return rotation.month_credits_used + candidate.estimated_credits <= rotation.monthly_ceiling;
}

export function formatPassDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}
