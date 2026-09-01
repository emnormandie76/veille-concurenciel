/**
 * eslint.config.mjs — configuration ESLint (format plat, ESLint 9)
 *
 * Le dépôt ne contenait aucune configuration ESLint ni aucune dépendance
 * ESLint, alors que `npm run lint` appelait `next lint` — commande retirée dans
 * Next.js 16. La commande ne pouvait aboutir dans aucune configuration ; l'étape
 * ESLint de la CI échouait donc depuis la montée en version.
 *
 * `eslint-config-next` v16 exporte directement des configurations plates :
 * aucun FlatCompat n'est nécessaire.
 *
 * ─── Politique de sévérité ────────────────────────────────────────────────
 * Introduire un linter sur un code existant impose un choix : soit on bloque
 * tout de suite sur les 57 erreurs remontées et personne ne peut plus livrer,
 * soit on établit une base qui passe et on résorbe la dette en la gardant
 * visible. C'est le second parti qui est pris ici. Chaque assouplissement est
 * justifié ci-dessous ; aucun n'est un silence commode.
 */
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "backend/**",
      "prisma/migrations/**",
      "next-env.d.ts",
      "*.tsbuildinfo",
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // ── Désactivée ────────────────────────────────────────────────────
      // 36 occurrences, toutes des apostrophes de texte français
      // (« l'école », « aujourd'hui »). Le correctif attendu est &apos;, qui
      // rendrait les libellés illisibles dans le source pour un gain nul :
      // React échappe déjà ces caractères au rendu.
      "react/no-unescaped-entities": "off",

      // ── Dette à résorber, maintenue visible ───────────────────────────
      // Règles issues du compilateur React, nouvelles dans la configuration
      // Next 16. Elles signalent de vrais motifs discutables, mais les
      // corriger demande de retoucher les composants d'administration un par
      // un — un chantier en soi, à mener avec une recette de l'interface.
      "react-hooks/immutability": "warn",       // 11 occurrences
      "react-hooks/set-state-in-effect": "warn", // 7 occurrences
      "react-hooks/purity": "warn",              // 2 occurrences

      // `any` est massivement présent dans l'interface d'administration
      // (une soixantaine d'occurrences). En avertissement, il reste chiffrable.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
