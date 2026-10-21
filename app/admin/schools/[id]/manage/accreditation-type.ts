/**
 * app/admin/schools/[id]/manage/accreditation-type.ts — Le badge du type d'une accréditation, dans l'onglet « Accréditations »
 *
 * Plan gestion-contenu, étape 10 : la carte d'une accréditation affichait la
 * valeur de la base (`international`, `state`, `label`) ; elle affiche
 * désormais « International », « État », « Label », comme la liste du
 * formulaire. La base, les routes, l'API v1 et /api-docs gardent les
 * valeurs. Les tons de catégorie sont ceux du lot 2 de l'étape 9 (charte
 * §6). Module sans dépendance, testé par test/manager-screens.test.ts.
 */

import type { BadgeTone } from "@/components/ui/Badge";

export const ACCREDITATION_TYPE_LABELS: Record<string, string> = {
  international: "International",
  state: "État",
  label: "Label",
};

// Trois catégories, trois tons de catégorie (charte §6).
export const ACCREDITATION_TYPE_TONES: Record<string, BadgeTone> = {
  international: "accent",
  state: "solid",
  label: "neutral",
};

/** Le texte du badge ; une valeur inconnue (la colonne n'a pas de contrainte) telle quelle. */
export function accreditationTypeLabel(type: string): string {
  return ACCREDITATION_TYPE_LABELS[type] ?? type;
}

/** Le ton du badge ; neutre pour une valeur inconnue. */
export function accreditationTypeTone(type: string): BadgeTone {
  return ACCREDITATION_TYPE_TONES[type] ?? "neutral";
}
