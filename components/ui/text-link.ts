/**
 * components/ui/text-link.ts — le lien dans un texte (charte, étape 4)
 *
 * Souligné, en couleur d'accent : un lien se reconnaît sans dépendre de la
 * seule couleur (accessibilité). Se pose sur un `next/link` comme sur un `<a>`.
 */
export const TEXT_LINK =
  "font-medium text-accent-strong underline underline-offset-2 hover:no-underline " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
