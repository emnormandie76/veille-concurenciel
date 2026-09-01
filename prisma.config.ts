/**
 * prisma.config.ts — Configuration Prisma ORM v7
 *
 * Prisma 7 a déplacé la connexion DB du schema.prisma vers ce fichier.
 * Référence : https://pris.ly/d/config-datasource
 *
 * Note Neon.tech :
 *   - DATABASE_URL → URL pooler (PgBouncer) → pour les requêtes runtime Next.js
 *   - DIRECT_URL   → URL directe (sans pooler) → pour les migrations Prisma CLI
 *     Le pooler ne supporte pas les migrations (limitation PgBouncer).
 *   - SHADOW_DATABASE_URL → base jetable utilisée par `prisma migrate dev` et
 *     `prisma migrate diff --from-migrations` pour rejouer l'historique.
 *     Optionnelle : sans elle, Prisma en crée une à la volée sur le serveur.
 */

import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Charger .env.local (priorité Next.js) puis .env (fallback)
config({ path: ".env.local" });
config({ path: ".env" });

// L'arbitrage se fait sur process.env, PAS sur le retour de env().
// env() construit un objet de référence à résoudre plus tard : il est toujours
// vrai, donc `env("DIRECT_URL") || env("DATABASE_URL")` retournait
// systématiquement la première branche et le repli n'existait pas.
const MIGRATION_URL_VAR = process.env.DIRECT_URL ? "DIRECT_URL" : "DATABASE_URL";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Connexion directe pour les migrations, repli sur le pooler si absente.
    url: env(MIGRATION_URL_VAR),
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: env("SHADOW_DATABASE_URL") }
      : {}),
  },
});
