/**
 * app/admin/schools/[id]/LastEdit.tsx — Qui a modifié une donnée, et quand, dans le gestionnaire
 *
 * Plan gestion-contenu, étape 5, décision D29 : sous chaque donnée des écrans
 * de gestion d'une école, « Modifié par Camille Martin le 19 octobre 2026 »,
 * le nom et la date, sans l'origine. Le texte arrive tout fait des routes de
 * lecture (`last_edit`, lib/provenance.ts `forManager`) : ce composant ne fait
 * que le poser, et rien pour une donnée d'avant le suivi.
 *
 * À l'ancien style, comme `app/schools/SourceLine.tsx` (décision D28) : ces
 * écrans passent à la charte à l'étape 9, et ce composant avec eux.
 */

interface Props {
  /** « Modifié par … le … », ou `null`. */
  text: string | null | undefined;
}

export default function LastEdit({ text }: Props) {
  if (!text) return null;
  return (
    <div style={{ fontSize: "0.75rem", fontWeight: 400, color: "var(--text-secondary)", marginTop: 4 }}>{text}</div>
  );
}
