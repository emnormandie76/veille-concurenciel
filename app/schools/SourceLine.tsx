/**
 * app/schools/SourceLine.tsx — D'où vient une donnée, et qui l'a modifiée
 *
 * Plan gestion-contenu, étape 5 : sous chaque donnée des fiches, son lien
 * source et « Modifié par … le … », comme le lien « Source ↗ » des
 * classements le faisait déjà. Le texte vient de lib/provenance.ts
 * (`describeProvenance`, `sourceHref`) : ce composant ne fait que le poser.
 *
 * À l'ancien style, sur le motif du lien des classements (décision D28) : les
 * fiches passent à la charte à l'étape 9, et ce composant avec elles.
 */

interface Props {
  /** Un lien déjà vérifié (`sourceHref`) : seul un lien http(s) arrive ici. */
  href: string | null;
  /** « Modifié par … le … » (`describeProvenance`), ou `null`. */
  provenance: string | null;
}

export default function SourceLine({ href, provenance }: Props) {
  if (!href && !provenance) return null;
  return (
    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: 4 }}>
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
          Source ↗
        </a>
      )}
      {href && provenance && " · "}
      {provenance}
    </div>
  );
}
