/**
 * lib/content-cache.ts — Les routes de l'API suivent les écritures du contenu (D26)
 *
 * Plan gestion-contenu, étape 5, piège 4 : les routes `/api/schools/[id]` et
 * `/api/schools/[id]/programs/[pid]` sont en cache d'une heure
 * (`revalidate = 3600`). Sans revalidation, une modification, et son
 * « modifié par », n'y apparaîtraient qu'au plus une heure plus tard.
 *
 * Après chaque écriture réussie du contenu, `revalidateContent()` les
 * invalide toutes d'un coup : `revalidatePath(…, "layout")` vise les
 * étiquettes que Next dérive du motif de la route (`/api/schools/layout`
 * porte les deux), et chacune se régénère à sa visite suivante (doc Next 16 :
 * `revalidatePath`, depuis un Route Handler). Six écoles et une cinquantaine
 * de programmes : régénérer large ne coûte rien, et dispense de savoir
 * quelles données une écriture touche.
 *
 * Les fiches école et programme (`/schools/…`) n'ont plus de cache depuis
 * la CSP à nonce (étape 15, D123) : elles se rendent à chaque visite, et ne
 * sont plus revalidées. La liste `/api/schools` non plus, qui est dynamique.
 *
 * Un échec de la revalidation est journalisé et n'annule pas l'écriture, déjà
 * faite : la route se mettra à jour avec le cache, sous une heure.
 */

import { revalidatePath } from "next/cache";

/** Les routes en cache qui montrent le contenu. */
export const CONTENT_PATHS = ["/api/schools"] as const;

export function revalidateContent(): void {
  for (const path of CONTENT_PATHS) {
    try {
      revalidatePath(path, "layout");
    } catch (err) {
      console.error(`[cache] revalidation de ${path} échouée : l'API se mettra à jour sous une heure.`, err);
    }
  }
}
