/**
 * lib/pipeline-history.ts — Le bandeau des contributions qui attendent le backend local
 *
 * L'inbox compte les contributions `Pending_AI` : elles n'avancent qu'au
 * lancement du backend, sur le poste de l'admin. Le reste de ce module (les
 * libellés de l'historique des jobs de /admin/cron) est parti avec la console
 * IA sur la branche `local` (plan gestion-contenu, étape 11, D100).
 */

/** Le bandeau des contributions en attente du backend local ; `null` s'il n'y en a pas. */
export function describePendingAi(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 contribution attend le traitement par le backend local."
    : `${count} contributions attendent le traitement par le backend local.`;
}
