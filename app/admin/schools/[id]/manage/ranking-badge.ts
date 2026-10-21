/**
 * app/admin/schools/[id]/manage/ranking-badge.ts — Le badge d'un rang, dans l'onglet « Classements »
 *
 * Plan gestion-contenu, étape 9, lot 3, décision D68 : les médailles de
 * l'ancien style (🥇 🥈 🥉) partent avec les émojis (D56), les textes restent
 * (« 1er », « 2ème », « 3ème », sinon « #N »). Les trois paliers que le code
 * tenait déjà gardent leur distinction, en tons de catégorie (charte §6 : un
 * rang n'est pas un état) : le podium en `solid`, de 4 à 10 en `accent`,
 * au-delà en `neutral`. Module sans dépendance, testé par
 * test/manager-screens.test.ts.
 */

import type { BadgeTone } from "@/components/ui/Badge";

/** Le ton du badge d'un rang : podium, dix premiers, ou le reste. */
export function rankTone(rank: number): BadgeTone {
  if (rank <= 3) return "solid";
  if (rank <= 10) return "accent";
  return "neutral";
}

/** Le texte du badge d'un rang, celui de l'ancien écran sans ses médailles. */
export function rankLabel(rank: number): string {
  if (rank === 1) return "1er";
  if (rank === 2) return "2ème";
  if (rank === 3) return "3ème";
  return "#" + rank;
}
