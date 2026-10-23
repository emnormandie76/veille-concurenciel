/**
 * lib/csp.ts — La politique de sécurité du contenu (CSP), à nonce
 *
 * Plan gestion-contenu, étape 15, D123. Jusque-là, `next.config.ts` posait une
 * CSP fixe dont `script-src` gardait `'unsafe-inline'` : Next injecte en ligne
 * l'amorçage de l'hydratation, et toute balise <script> injectée dans une page
 * se serait exécutée. Désormais, le proxy (`proxy.ts`) tire un nonce à chaque
 * requête et pose cette CSP :
 * - sur la requête, où Next la lit au rendu et pose le nonce sur ses propres
 *   scripts (node_modules/next/dist/docs, guide « Content Security Policy ») ;
 * - sur la réponse, où le navigateur l'applique : seul un script qui porte le
 *   nonce s'exécute, et ceux qu'il charge (`'strict-dynamic'`).
 *
 * Un nonce n'existe qu'au rendu d'une requête : toutes les pages sont
 * dynamiques (`app/layout.tsx`), aucune n'est en cache. `style-src` garde
 * `'unsafe-inline'` (hors de D123). Le reste de la politique est celui de
 * l'étape 3, inchangé.
 */

/** Un nonce neuf : 36 caractères aléatoires (UUID v4, 122 bits d'aléa), en base64. */
export function createNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * La CSP d'une requête. `'unsafe-eval'` en développement seulement : le
 * rafraîchissement à chaud et les piles d'erreur de React l'exigent, la
 * production jamais.
 */
export function contentSecurityPolicy(nonce: string, dev = process.env.NODE_ENV !== "production"): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}
