import type { BadgeTone } from "@/components/ui/Badge";

/**
 * app/admin/schools/school-status.ts — le ton du badge de statut d'une école
 *
 * Plan gestion-contenu, étape 9, décision D66 : un ton par statut, sur la liste
 * des écoles comme dans l'en-tête de leur gestion. La liste peignait tout
 * statut en vert, l'en-tête mettait DRAFT en vert. Le texte du badge reste
 * le statut lui-même (ACTIVE, INACTIVE, DRAFT).
 */

export const SCHOOL_STATUS_TONES: Record<string, BadgeTone> = {
  ACTIVE: "success",
  INACTIVE: "neutral",
  DRAFT: "warning",
};

/** Le ton d'un statut ; neutre pour un statut inconnu. */
export function schoolStatusTone(status: string): BadgeTone {
  return SCHOOL_STATUS_TONES[status] ?? "neutral";
}
