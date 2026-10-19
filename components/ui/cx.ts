/**
 * components/ui/cx.ts — assemble des noms de classe (charte, étape 4)
 *
 * Ignore les valeurs fausses. Ne fusionne pas les classes Tailwind qui se
 * contredisent : le `className` d'un appelant sert à placer un composant
 * (marges, largeur), pas à changer ses couleurs ou sa taille, qui passent par
 * ses variantes (docs/architecture/charte-graphique.md, « Composants »).
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
