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
 */

import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Charger .env.local (priorité Next.js) puis .env (fallback)
config({ path: ".env.local" });
config({ path: ".env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Utiliser DIRECT_URL pour les migrations (connexion directe sans pooler)
    // Fallback sur DATABASE_URL si DIRECT_URL n'est pas défini
    url: env("DIRECT_URL") || env("DATABASE_URL"),
  },
});
