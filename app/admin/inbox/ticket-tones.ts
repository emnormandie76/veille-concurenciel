import type { BadgeTone } from "@/components/ui/Badge";

/**
 * app/admin/inbox/ticket-tones.ts — les tons des badges de l'inbox
 *
 * Plan gestion-contenu, étape 9, lot 4, décision D77 : un ton par état, comme
 * les signalements. Un ticket `Pending_Admin` attend l'admin (avertissement),
 * un `Pending_AI` attend le backend (neutre) ; un ticket rejeté est fermé sans
 * défaut (neutre), un ticket en échec est en défaut (danger). Les textes ne
 * changent pas : le statut lui-même, en anglais.
 *
 * Les alertes d'un ticket : « Année supposée » et « Nom incohérent » en
 * avertissement (l'orange de l'ancien style n'existe pas dans la charte),
 * « Conflit » en danger. La correspondance d'un programme extrait avec un
 * programme en base garde ses textes, sans leur symbole (D78).
 */

export const TICKET_STATUS_TONES: Record<string, BadgeTone> = {
  Pending_AI: "neutral",
  Pending_Admin: "warning",
  Validated: "success",
  Rejected: "neutral",
  Failed: "danger",
};

/** Le ton d'un statut ; neutre pour un statut inconnu. */
export function ticketStatusTone(status: string): BadgeTone {
  return TICKET_STATUS_TONES[status] ?? "neutral";
}

export const FLAG_TONES = {
  year_assumed: "warning",
  data_conflict_warning: "danger",
  program_name_mismatch: "warning",
} as const satisfies Record<string, BadgeTone>;

const MATCH_CONFIDENCE: Record<string, { tone: BadgeTone; label: string }> = {
  exact: { tone: "success", label: "Match exact" },
  fuzzy: { tone: "warning", label: "Match approximatif" },
  none: { tone: "danger", label: "Non matché" },
};

/** Le badge de la correspondance d'un programme ; « Non matché » pour une valeur inconnue, comme avant. */
export function matchConfidence(confidence: string): { tone: BadgeTone; label: string } {
  return MATCH_CONFIDENCE[confidence] ?? MATCH_CONFIDENCE.none;
}
