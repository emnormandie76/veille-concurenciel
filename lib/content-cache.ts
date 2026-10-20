/**
 * lib/content-cache.ts — Les fiches suivent les écritures du contenu (D26)
 *
 * Plan gestion-contenu, étape 5, piège 4 : les fiches école et programme et
 * les routes `/api/schools/*` de l'accueil sont en cache ISR d'une heure
 * (`revalidate = 3600`). Sans revalidation, une modification, et son
 * « modifié par », n'apparaîtraient qu'au plus une heure plus tard.
 *
 * Après chaque écriture réussie du contenu, `revalidateContent()` invalide
 * toutes ces pages d'un coup : `revalidatePath(…, "layout")` vise les
 * étiquettes que Next dérive du motif de la route (`/schools/layout` porte
 * `/schools/[id]` et `/schools/[id]/programs/[pid]`), et chacune se régénère
 * à sa visite suivante (doc Next 16 : `revalidatePath`, depuis un Route
 * Handler). Six écoles et une cinquantaine de programmes : régénérer large
 * ne coûte rien, et dispense de savoir quelles fiches une écriture touche
 * (un campus renommé paraît sur chaque fiche de programme de l'école).
 *
 * Un échec de la revalidation est journalisé et n'annule pas l'écriture, déjà
 * faite : la page se mettra à jour avec le cache, sous une heure.
 */

import { revalidatePath } from "next/cache";

/** Les pages et routes en cache qui montrent le contenu. */
export const CONTENT_PATHS = ["/schools", "/api/schools"] as const;

export function revalidateContent(): void {
  for (const path of CONTENT_PATHS) {
    try {
      revalidatePath(path, "layout");
    } catch (err) {
      console.error(`[cache] revalidation de ${path} échouée : les fiches se mettront à jour sous une heure.`, err);
    }
  }
}
