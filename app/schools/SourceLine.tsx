/**
 * app/schools/SourceLine.tsx — D'où vient une donnée, et qui l'a modifiée
 *
 * Plan gestion-contenu, étape 5 : sous chaque donnée des fiches, son lien
 * source et « Modifié par … le … », comme le lien « Source ↗ » des
 * classements le faisait déjà. Le texte vient de lib/provenance.ts
 * (`describeProvenance`, `sourceHref`) : ce composant ne fait que le poser.
 *
 * Dans la charte depuis l'étape 9 (lot 1), avec les fiches : petit texte
 * secondaire, le lien souligné (`TEXT_LINK`). Il était à l'ancien style
 * jusque-là (décision D28).
 */

import { TEXT_LINK } from "@/components/ui/text-link";

interface Props {
  /** Un lien déjà vérifié (`sourceHref`) : seul un lien http(s) arrive ici. */
  href: string | null;
  /** « Modifié par … le … » (`describeProvenance`), ou `null`. */
  provenance: string | null;
}

export default function SourceLine({ href, provenance }: Props) {
  if (!href && !provenance) return null;
  return (
    <div className="text-xs leading-relaxed text-ink-2">
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
          Source ↗
        </a>
      )}
      {href && provenance && " · "}
      {provenance}
    </div>
  );
}
