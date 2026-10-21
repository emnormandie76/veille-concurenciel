import type { BadgeTone } from "@/components/ui/Badge";
import type { ProgressTone } from "@/components/ui/ProgressBar";
import type { CrowdsourcingTone } from "@/lib/crowdsourcing-status";
import type { StatusTone } from "@/lib/pipeline-history";
import type { RotationMode } from "@/lib/rotation-status";

/**
 * app/admin/cron/cron-tones.ts — les tons de /admin/cron
 *
 * Plan gestion-contenu, étape 9, lot 5, décision D87 : un ton par état, comme
 * l'inbox (D77). Un job terminé est en réussite, un job en échec en danger ;
 * en file ou en cours, il n'y a rien à faire : neutre. Les passes dues « sur
 * demande » sont le mode normal (neutre) ; « plafond à 0 », aucune ne tient
 * (avertissement). Les textes ne changent pas : ils viennent de lib/.
 *
 * D86 : l'usage d'un quota (les crédits du mois sur le plafond, une clé
 * Tavily) garde les seuils d'avant : épuisé, danger ; à 75 % ou plus,
 * avertissement ; sinon réussite.
 */

export const JOB_STATUS_TONES: Record<StatusTone, BadgeTone> = {
  pending: "neutral",
  ok: "success",
  error: "danger",
};

export const ROTATION_MODE_TONES: Record<RotationMode, BadgeTone> = {
  on_demand: "neutral",
  ceiling_zero: "warning",
};

export type UsageTone = Exclude<ProgressTone, "accent">;

/** Le ton d'un usage : `used` sur `total`. */
export function usageTone(used: number, total: number): UsageTone {
  if (used >= total) return "danger";
  const pct = total > 0 ? (used / total) * 100 : 0;
  return pct >= 75 ? "warning" : "success";
}

/** Les chiffres d'une clé Tavily, au ton de son usage. */
export const USAGE_TEXT_TONES: Record<UsageTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

/** Le titre du bloc « Contributions du public », au ton de son dernier passage. */
export const CROWDSOURCING_TEXT_TONES: Record<CrowdsourcingTone, string> = {
  muted: "text-ink-2",
  ok: "text-success",
  warning: "text-warning",
  error: "text-danger",
};
