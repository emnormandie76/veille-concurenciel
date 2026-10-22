/**
 * scripts/lib/migration-plan.ts — État des migrations Prisma, sans la CLI
 *
 * MODULE PUR : ni base, ni fichier, ni réseau. Il compare les dossiers de
 * `prisma/migrations` aux lignes de `_prisma_migrations`, comme le fait
 * `prisma migrate status`. `scripts/db-migrate.ts` s'en sert quand la CLI
 * Prisma ne peut pas joindre la base (5432 fermé, `DB_DRIVER=neon-ws`).
 *
 * L'empreinte d'une migration est le sha256 hexadécimal des octets de son
 * `migration.sql`. La base mélange des empreintes calculées en LF et en CRLF,
 * et Git peut extraire le fichier en CRLF sous Windows : une ligne est
 * appliquée si son empreinte correspond aux octets tels quels, en LF ou en
 * CRLF. Constat du 14 octobre 2026 : trois migrations ne concordent qu'en LF,
 * alors que le fichier du poste est en CRLF.
 *
 * Voir docs/architecture/bdd.md §4 (le lanceur db:migrate).
 */

import { createHash } from "node:crypto";

export interface MigrationFolder {
  /** Nom du dossier, par exemple `20260520095936_init`. */
  name: string;
  /** Octets de `migration.sql`, tels que lus sur le disque. */
  bytes: Uint8Array;
}

/** Une ligne de `_prisma_migrations` (colonnes utiles). */
export interface MigrationRow {
  migration_name: string;
  checksum: string;
  finished_at: Date | string | null;
  rolled_back_at: Date | string | null;
}

export interface MigrationPlan {
  /** Appliquées, empreinte concordante. */
  applied: string[];
  /** Présentes dans le dépôt, absentes de la base : à appliquer, dans cet ordre. */
  pending: string[];
  /** Appliquées, mais le fichier a changé depuis. */
  checksumMismatch: string[];
  /** Commencées, jamais finies ni annulées. */
  failed: string[];
  /** Inscrites en base, sans dossier dans le dépôt. */
  unknownInDb: string[];
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// latin1 fait correspondre un octet à un caractère, dans les deux sens : les
// remplacements ci-dessous ne touchent que CR et LF, et rien d'autre.
function toLf(bytes: Uint8Array): Buffer {
  return Buffer.from(Buffer.from(bytes).toString("latin1").replace(/\r\n/g, "\n"), "latin1");
}

function toCrlf(bytes: Uint8Array): Buffer {
  return Buffer.from(toLf(bytes).toString("latin1").replace(/\n/g, "\r\n"), "latin1");
}

/** Empreintes acceptées pour un fichier : octets bruts, forme LF, forme CRLF. */
export function acceptedChecksums(bytes: Uint8Array): Set<string> {
  return new Set([sha256Hex(bytes), sha256Hex(toLf(bytes)), sha256Hex(toCrlf(bytes))]);
}

const isSet = (value: Date | string | null) => value !== null && value !== undefined;

/**
 * Classe chaque migration. Pour un même nom, Prisma peut avoir plusieurs
 * lignes (un échec annulé, puis un nouvel essai) :
 * - une ligne ni finie ni annulée → `failed` ;
 * - sinon, une ligne finie et non annulée → `applied` si son empreinte
 *   concorde, `checksumMismatch` sinon ;
 * - sinon (aucune ligne, ou seulement des lignes annulées) → `pending`.
 * Les noms de chaque liste sont triés : c'est l'ordre d'application.
 */
export function planMigrations(
  folders: MigrationFolder[],
  rows: MigrationRow[],
): MigrationPlan {
  const plan: MigrationPlan = {
    applied: [],
    pending: [],
    checksumMismatch: [],
    failed: [],
    unknownInDb: [],
  };

  const rowsByName = new Map<string, MigrationRow[]>();
  for (const row of rows) {
    const list = rowsByName.get(row.migration_name) ?? [];
    list.push(row);
    rowsByName.set(row.migration_name, list);
  }

  const sorted = [...folders].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const folder of sorted) {
    const live = (rowsByName.get(folder.name) ?? []).filter((r) => !isSet(r.rolled_back_at));
    if (live.some((r) => !isSet(r.finished_at))) {
      plan.failed.push(folder.name);
      continue;
    }
    if (live.length === 0) {
      plan.pending.push(folder.name);
      continue;
    }
    const accepted = acceptedChecksums(folder.bytes);
    if (live.some((r) => accepted.has(r.checksum))) {
      plan.applied.push(folder.name);
    } else {
      plan.checksumMismatch.push(folder.name);
    }
  }

  const known = new Set(folders.map((f) => f.name));
  plan.unknownInDb = [...rowsByName.keys()].filter((name) => !known.has(name)).sort();
  return plan;
}

/**
 * Ce qui interdit un déploiement. Liste vide : on peut appliquer `pending`.
 * Une migration inconnue du dépôt est signalée par `status`, sans bloquer.
 */
export function deployBlockers(plan: MigrationPlan): string[] {
  const blockers: string[] = [];
  if (plan.checksumMismatch.length > 0) {
    blockers.push(
      `migration(s) appliquée(s) puis modifiée(s) dans le dépôt : ${plan.checksumMismatch.join(", ")}. ` +
        "Un migration.sql appliqué ne se retouche jamais.",
    );
  }
  if (plan.failed.length > 0) {
    blockers.push(
      `migration(s) en échec dans la base : ${plan.failed.join(", ")}. ` +
        "À résoudre à la main avant tout nouveau déploiement.",
    );
  }
  return blockers;
}
