/**
 * scripts/db-migrate.ts — État et application des migrations Prisma, en 5432 ou
 * en WebSocket
 *
 *     npm run db:status          # lecture seule
 *     npm run db:migrate         # applique les migrations en attente
 *     npm run db:migrate:dry     # les applique puis ROLLBACK : rien n'est inscrit
 *
 * Le réseau de l'établissement ferme le port 5432 de Neon, et la CLI Prisma 7
 * n'a aucun adaptateur pour Migrate. Selon `DB_DRIVER` :
 * - absente : `npx prisma migrate status|deploy`, comme avant (port 5432) ;
 * - `neon-ws` : `Pool` de `@neondatabase/serverless` en WebSocket (443), sur
 *   `DIRECT_URL`, repli sur `DATABASE_URL` (la règle de `prisma.config.ts`).
 *   Le plan vient de `scripts/lib/migration-plan.ts`, l'application de
 *   `scripts/lib/migration-runner.ts` ;
 * - toute autre valeur : refus, sans repli.
 *
 * Variables : celles de l'environnement, puis `.env.development.local`,
 * `.env.local` et `.env`, dans l'ordre de priorité de Next.js en
 * développement. `DB_DRIVER` se pose dans `.env.development.local` : poste
 * local seulement, jamais sur Vercel.
 *
 * Aucune URL n'est affichée, seulement l'hôte. Voir
 * docs/architecture/bdd.md §4 (le lanceur db:migrate).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { neonConfig, Pool, type PoolClient } from "@neondatabase/serverless";
import { config } from "dotenv";
import ws from "ws";

import {
  deployBlockers,
  planMigrations,
  sha256Hex,
  type MigrationFolder,
  type MigrationPlan,
  type MigrationRow,
} from "./lib/migration-plan";
import {
  applyMigrations,
  connectionHost,
  describeError,
  migrationUrl,
  redactSecrets,
  resolveDriver,
} from "./lib/migration-runner";

const MIGRATIONS_DIR = path.join("prisma", "migrations");
const ENV_FILES = [".env.development.local", ".env.local", ".env"];

type Command = { action: "status" } | { action: "deploy"; dryRun: boolean };

const USAGE = "Usage : tsx scripts/db-migrate.ts status | deploy [--dry-run]";

function parseArgs(argv: string[]): Command | null {
  const [action, ...rest] = argv;
  if (action === "status" && rest.length === 0) return { action: "status" };
  if (action === "deploy" && rest.length === 0) return { action: "deploy", dryRun: false };
  if (action === "deploy" && rest.length === 1 && rest[0] === "--dry-run") {
    return { action: "deploy", dryRun: true };
  }
  return null;
}

function readFolders(): MigrationFolder[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = path.join(MIGRATIONS_DIR, entry.name, "migration.sql");
      if (!existsSync(file)) {
        throw new Error(`${file} est absent : dossier de migration incomplet.`);
      }
      return { name: entry.name, bytes: readFileSync(file) };
    });
}

// ── Sans DB_DRIVER : la CLI Prisma ──────────────────────────────────

function runPrismaCli(command: Command): number {
  if (command.action === "deploy" && command.dryRun) {
    console.error(
      "deploy --dry-run n'existe qu'avec DB_DRIVER=neon-ws : la CLI Prisma n'a pas " +
        "de passe à blanc. Rien n'a été lancé.",
    );
    return 2;
  }
  const sub = command.action;
  console.log(`DB_DRIVER absente : CLI Prisma (npx prisma migrate ${sub}), port 5432.`);
  // Commande fixe, sans argument venu de l'extérieur : `shell` est sans risque
  // ici, et nécessaire sous Windows pour trouver npx.
  const result = spawnSync(`npx prisma migrate ${sub}`, {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (result.error) {
    console.error(`CLI Prisma injoignable : ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

// ── Avec DB_DRIVER=neon-ws : WebSocket ──────────────────────────────

async function readRows(client: PoolClient): Promise<MigrationRow[]> {
  // Lecture dans une transaction en lecture seule : `status` ne peut rien
  // écrire. (Pas de SET de session : derrière le pooler, il déborderait sur
  // les autres clients.)
  await client.query("BEGIN READ ONLY");
  try {
    const result = await client.query(
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at',
    );
    await client.query("COMMIT");
    return result.rows as MigrationRow[];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { code?: string }).code === "42P01") {
      throw new Error(
        "La table _prisma_migrations est absente : cette base n'a jamais été migrée. " +
          "Le premier déploiement se fait avec la CLI Prisma (sans DB_DRIVER), " +
          "depuis un réseau où le port 5432 sort.",
      );
    }
    throw error;
  }
}

function printPlan(plan: MigrationPlan, folderCount: number): void {
  console.log(`Migrations du dépôt (${MIGRATIONS_DIR}) : ${folderCount}`);
  console.log(`  appliquées           : ${plan.applied.length}`);
  console.log(`  en attente           : ${plan.pending.length}`);
  const lists: [string, string[]][] = [
    ["en attente", plan.pending],
    ["empreinte divergente", plan.checksumMismatch],
    ["en échec dans la base", plan.failed],
    ["en base, absentes du dépôt", plan.unknownInDb],
  ];
  for (const [label, names] of lists) {
    if (names.length === 0) continue;
    console.log(`  ${label} :`);
    for (const name of names) console.log(`    - ${name}`);
  }
}

function isUpToDate(plan: MigrationPlan): boolean {
  return (
    plan.pending.length === 0 &&
    plan.checksumMismatch.length === 0 &&
    plan.failed.length === 0 &&
    plan.unknownInDb.length === 0
  );
}

async function runNeonWs(command: Command, url: string): Promise<number> {
  const folders = readFolders();

  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 20_000 });
  pool.on("error", (error: Error) => {
    console.error(`Connexion perdue : ${redactSecrets(describeError(error), url)}`);
  });

  const client = await pool.connect();
  try {
    const plan = planMigrations(folders, await readRows(client));
    printPlan(plan, folders.length);

    if (command.action === "status") {
      if (isUpToDate(plan)) {
        console.log(
          `✔ Base à jour : ${plan.applied.length} migrations appliquées, aucune en attente.`,
        );
        return 0;
      }
      console.log("✖ La base n'est pas alignée sur le dépôt (détail ci-dessus).");
      return 1;
    }

    const blockers = deployBlockers(plan);
    if (blockers.length > 0) {
      for (const blocker of blockers) console.error(`✖ ${blocker}`);
      console.error("Déploiement refusé : rien n'a été appliqué.");
      return 1;
    }
    if (plan.pending.length === 0) {
      console.log("✔ Rien à appliquer.");
      return 0;
    }

    const byName = new Map(folders.map((f) => [f.name, f]));
    const pending = plan.pending.map((name) => {
      const bytes = byName.get(name)!.bytes;
      return { name, sql: Buffer.from(bytes).toString("utf8"), checksum: sha256Hex(bytes) };
    });

    console.log(
      command.dryRun
        ? `Passe à blanc : ${pending.length} migration(s), puis ROLLBACK.`
        : `Application de ${pending.length} migration(s), une transaction chacune.`,
    );
    const done = await applyMigrations(client, pending, { dryRun: command.dryRun });
    for (const name of done) {
      console.log(`  ${command.dryRun ? "vérifiée" : "appliquée"} : ${name}`);
    }
    console.log(
      command.dryRun
        ? "✔ Passe à blanc réussie : tout a été annulé, rien n'est inscrit."
        : `✔ ${done.length} migration(s) appliquée(s).`,
    );
    return 0;
  } finally {
    client.release();
    await pool.end();
  }
}

// ── Entrée ──────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const command = parseArgs(process.argv.slice(2));
  if (!command) {
    console.error(USAGE);
    return 2;
  }

  // Ne remplace jamais une variable déjà posée : le premier fichier l'emporte.
  for (const file of ENV_FILES) config({ path: file, quiet: true });

  const driver = resolveDriver(process.env.DB_DRIVER);
  if (driver === null) return runPrismaCli(command);

  const { name, url } = migrationUrl(process.env);
  console.log(`Pilote neon-ws : WebSocket (443) vers ${connectionHost(url)} (${name}).`);
  try {
    return await runNeonWs(command, url);
  } catch (error) {
    console.error(`✖ ${redactSecrets(describeError(error), url)}`);
    return 1;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // Erreurs d'avant la connexion (pilote inconnu, variable absente) : aucune
    // ne contient d'URL.
    console.error(`✖ ${describeError(error)}`);
    process.exitCode = 1;
  },
);
