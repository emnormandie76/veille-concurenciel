/**
 * components/ui/tabs-keys.ts — le clavier des onglets (charte, étape 4)
 *
 * Le modèle « onglets » de l'ARIA : un seul onglet dans l'ordre de
 * tabulation (le choisi) ; les flèches gauche et droite passent à l'onglet
 * voisin en bouclant, Début et Fin vont au premier et au dernier. Module sans
 * dépendance, testé par test/ui-components.test.ts.
 */

/** L'onglet à choisir après la touche `key`, ou `null` si la touche n'en change pas. */
export function nextTabIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

export const tabId = (idPrefix: string, value: string) => `${idPrefix}-tab-${value}`;
export const panelId = (idPrefix: string, value: string) => `${idPrefix}-panel-${value}`;
