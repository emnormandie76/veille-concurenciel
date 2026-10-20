/**
 * app/admin/schools/[id]/LastEdit.tsx — Qui a modifié une donnée, et quand, dans le gestionnaire
 *
 * Plan gestion-contenu, étape 5, décision D29 : sous chaque donnée des écrans
 * de gestion d'une école, « Modifié par Camille Martin le 19 octobre 2026 »,
 * le nom et la date, sans l'origine. Le texte arrive tout fait des routes de
 * lecture (`last_edit`, lib/provenance.ts `forManager`) : ce composant ne fait
 * que le poser, et rien pour une donnée d'avant le suivi.
 *
 * Dans la charte depuis l'étape 9 (lot 2), comme `app/schools/SourceLine.tsx` :
 * petit texte secondaire, placé par son parent. Jusqu'au lot 3, les onglets
 * encore à l'ancien style prennent la copie de `manage/legacy/` (D61).
 */

interface Props {
  /** « Modifié par … le … », ou `null`. */
  text: string | null | undefined;
}

export default function LastEdit({ text }: Props) {
  if (!text) return null;
  return <p className="text-xs leading-relaxed font-normal text-ink-2">{text}</p>;
}
