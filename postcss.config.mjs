/**
 * postcss.config.mjs — Tailwind CSS v4 (plan gestion-contenu, étape 4)
 *
 * Le seul greffon PostCSS du projet, comme le décrit la doc de Next 16
 * (node_modules/next/dist/docs/01-app/01-getting-started/11-css.md). Ce que
 * Tailwind importe et lit est réglé dans app/globals.css (pas de preflight
 * avant l'étape 9, piège 10).
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
