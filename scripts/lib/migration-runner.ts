/**
 * scripts/lib/migration-runner.ts — Application des migrations et réglages de
 * `scripts/db-migrate.ts`
 *
 * Aucun import réseau : le client SQL est passé en paramètre. En service,
 * c'est un client `Pool` de `@neondatabase/serverless` (WebSocket, 443) ;
 * dans les tests, un faux qui enregistre ses requêtes.
 *
 * Voir docs/features/backend-local.md, étape 2.2.
 */

import { randomUUID } from "node:crypto";

export const DB_DRIVER_NEON_WS = "neon-ws";

/** Le strict nécessaire d'un client `pg` / `@neondatabase/serverless`. */
export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<unknown>;
}

export interface PendingMigration {
  name: string;
  /** Contenu de `migration.sql`. */
  sql: string;
  /** sha256 hexadécimal des octets du fichier, tel que Prisma l'inscrit. */
  checksum: string;
}

export interface ApplyOptions {
  /** `true` : tout dans une transaction terminée par ROLLBACK, rien d'inscrit. */
  dryRun: boolean;
  newId?: () => string;
}

const INSERT_MIGRATION =
  'INSERT INTO "_prisma_migrations" ' +
  "(id, checksum, migration_name, started_at, finished_at, applied_steps_count, logs, rolled_back_at) " +
  "VALUES ($1, $2, $3, now(), now(), 1, NULL, NULL)";

async function rollbackQuietly(client: SqlClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // La connexion est peut-être déjà perdue : l'erreur d'origine prime.
  }
}

function failure(name: string, error: unknown): Error {
  return new Error(`Migration ${name} en échec, annulée : ${describeError(error)}`);
}

/**
 * Applique les migrations dans l'ordre donné et rend les noms traités.
 *
 * - Déploiement : chaque migration dans **sa** transaction (BEGIN, contenu du
 *   fichier, INSERT dans `_prisma_migrations`, COMMIT). Au premier échec :
 *   ROLLBACK de celle-ci, arrêt ; les précédentes restent appliquées, comme
 *   avec `prisma migrate deploy`.
 * - `dryRun` : la même suite de requêtes, mais toutes dans **une seule**
 *   transaction terminée par ROLLBACK. Une migration qui dépend de la
 *   précédente se vérifie donc aussi.
 */
export async function applyMigrations(
  client: SqlClient,
  migrations: PendingMigration[],
  { dryRun, newId = randomUUID }: ApplyOptions,
): Promise<string[]> {
  const done: string[] = [];

  if (dryRun) {
    await client.query("BEGIN");
    for (const m of migrations) {
      try {
        await client.query(m.sql);
        await client.query(INSERT_MIGRATION, [newId(), m.checksum, m.name]);
      } catch (error) {
        await rollbackQuietly(client);
        throw failure(m.name, error);
      }
      done.push(m.name);
    }
    await client.query("ROLLBACK");
    return done;
  }

  for (const m of migrations) {
    await client.query("BEGIN");
    try {
      await client.query(m.sql);
      await client.query(INSERT_MIGRATION, [newId(), m.checksum, m.name]);
      await client.query("COMMIT");
    } catch (error) {
      await rollbackQuietly(client);
      throw failure(m.name, error);
    }
    done.push(m.name);
  }
  return done;
}

/**
 * `DB_DRIVER` lue côté Node. Absente ou vide : `null` (CLI Prisma, 5432).
 * Toute autre valeur que `neon-ws` est refusée : pas de repli silencieux.
 */
export function resolveDriver(raw: string | undefined): typeof DB_DRIVER_NEON_WS | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value === DB_DRIVER_NEON_WS) return DB_DRIVER_NEON_WS;
  throw new Error(
    `DB_DRIVER=${JSON.stringify(raw?.trim())} inconnu. Valeurs acceptées : ` +
      `${DB_DRIVER_NEON_WS}, ou variable absente (CLI Prisma, port 5432).`,
  );
}

/** Même règle que `prisma.config.ts` : `DIRECT_URL`, sinon `DATABASE_URL`. */
export function migrationUrl(
  env: Record<string, string | undefined>,
): { name: "DIRECT_URL" | "DATABASE_URL"; url: string } {
  if (env.DIRECT_URL) return { name: "DIRECT_URL", url: env.DIRECT_URL };
  if (env.DATABASE_URL) return { name: "DATABASE_URL", url: env.DATABASE_URL };
  throw new Error("Ni DIRECT_URL ni DATABASE_URL ne sont définies.");
}

/** L'hôte seul, pour l'affichage : jamais l'URL, jamais les identifiants. */
export function connectionHost(url: string): string {
  try {
    return new URL(url).hostname || "(hôte inconnu)";
  } catch {
    return "(URL illisible)";
  }
}

/**
 * Message lisible d'une erreur. Le pilote WebSocket rejette parfois un
 * `ErrorEvent` de `ws`, et non une `Error` : son texte est dans `.error` ou
 * `.message`.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (error && typeof error === "object") {
    const event = error as { error?: unknown; message?: unknown; type?: unknown };
    if (event.error instanceof Error && event.error.message) return event.error.message;
    if (typeof event.message === "string" && event.message) return event.message;
    if (typeof event.type === "string") return `événement « ${event.type} » sans message`;
  }
  return String(error);
}

/**
 * Retire d'un message d'erreur l'URL de connexion et le mot de passe (encodé
 * ou non) avant de l'afficher.
 */
export function redactSecrets(text: string, url: string): string {
  const secrets = [url];
  try {
    const password = new URL(url).password;
    if (password) {
      secrets.push(password);
      try {
        secrets.push(decodeURIComponent(password));
      } catch {
        // Encodage invalide : la forme brute suffit.
      }
    }
  } catch {
    // URL illisible : seule la chaîne entière est retirée.
  }
  let result = text;
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join("***");
  }
  return result;
}
