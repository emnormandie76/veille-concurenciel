import type { NextConfig } from "next";

/**
 * En-têtes de sécurité.
 *
 * Le fichier était vide de toute configuration : aucune CSP, aucun HSTS, aucun
 * X-Frame-Options. Le back-office était encadrable en iframe (clickjacking) et
 * ne disposait d'aucune défense en profondeur.
 *
 * `unsafe-inline` reste nécessaire pour les scripts et les styles : Next.js
 * injecte l'amorçage d'hydratation en ligne. Le durcir demande une CSP à nonce
 * générée dans `proxy.ts` — chantier à part entière, à mener avec une recette
 * complète de l'interface. Ce qui est posé ici protège déjà de l'essentiel :
 * l'encadrement, l'injection de <base>, la soumission de formulaire vers un
 * tiers, et les objets embarqués.
 */
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // 'unsafe-eval' n'est requis que par le rafraîchissement à chaud du mode dev.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
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

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Doublon volontaire de frame-ancestors, pour les navigateurs anciens.
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
  /* School Data Pipeline — Next.js configuration */
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
