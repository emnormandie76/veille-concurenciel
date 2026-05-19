/**
 * lib/prisma.ts — Singleton Prisma Client
 * Évite les connexions multiples en développement (hot reload Next.js).
 * Pattern standard Next.js + Prisma recommandé par la documentation officielle.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

// Important for Neon Pool to pick it up directly if it falls back
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing!");
}

import { PrismaClient } from "@prisma/client";
import { neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const connectionString = process.env.DATABASE_URL!;

const adapter = new PrismaNeon({ connectionString });

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
