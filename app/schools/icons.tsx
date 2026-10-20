/**
 * app/schools/icons.tsx — Les icônes des fiches (étape 9, D56)
 *
 * Elles remplacent les émojis « repère » et « globe » de l'ancien style : décoratives,
 * cachées aux lecteurs d'écran, le texte voisin dit tout. Elles prennent la
 * couleur du texte (`currentColor`).
 */

/** Un repère de lieu, devant les campus d'un programme. */
export function PinIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-3.5 shrink-0">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 1.5a6 6 0 0 0-6 6c0 4.2 5.2 10.2 5.4 10.5a.8.8 0 0 0 1.2 0c.2-.3 5.4-6.3 5.4-10.5a6 6 0 0 0-6-6Zm0 8.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"
      />
    </svg>
  );
}

/** Un lien qui ouvre un autre site. */
export function ExternalIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-3.5 shrink-0">
      <path d="M11 4h5v5M16 4l-7 7M14 12v3.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5H8" />
    </svg>
  );
}
