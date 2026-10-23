import type { NextConfig } from "next";

/**
 * En-têtes de sécurité.
 *
 * Le fichier était vide de toute configuration : aucune CSP, aucun HSTS, aucun
 * X-Frame-Options. Le back-office était encadrable en iframe (clickjacking) et
 * ne disposait d'aucune défense en profondeur.
 *
 * La CSP n'est plus ici depuis l'étape 15 (plan gestion-contenu, D123) : elle
 * porte un nonce neuf à chaque requête, que seul le proxy peut tirer
 * (`proxy.ts`, `lib/csp.ts`) ; `'unsafe-inline'` a quitté `script-src`. Les
 * en-têtes ci-dessous sont fixes, sur toutes les réponses.
 */
const securityHeaders = [
  // Doublon volontaire de frame-ancestors (la CSP), pour les navigateurs anciens.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
