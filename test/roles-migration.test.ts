/**
 * test/roles-migration.test.ts — Les trois rôles, en base comme dans le code
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 1 (piège 7) : la contrainte CHECK de
 * `User.role` refusait tout rôle hors `ADMIN` et `MODERATOR`. Une nouvelle
 * migration la remplace, sans toucher l'ancienne : elle convertit `MODERATOR`
 * en `GESTIONNAIRE` et met le défaut à `USER`. Ce test lie la dernière
 * contrainte posée sur `User.role`, le défaut du schéma Prisma et
 * `USER_ROLES` de lib/roles.ts, comme test/test_contribution_enums.py le fait
 * pour l'inbox.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { USER_ROLES } from "../lib/roles";

const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");
const MIGRATION = "20261016120000_three_roles";

const read = (...parts: string[]) => fs.readFileSync(path.join(...parts), "utf-8");

/** Les migrations, dans l'ordre où Prisma les applique (par nom). */
function migrations(): string[] {
  return fs
    .readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Les instructions SQL, sans les commentaires. */
function statements(name: string): string {
  return read(MIGRATIONS, name, "migration.sql").replace(/--.*$/gm, "");
}

test("la migration des trois rôles existe et passe après toutes les autres", () => {
  const all = migrations();
  assert.equal(all.at(-1), MIGRATION);
});

test("la dernière contrainte posée sur User.role est celle de lib/roles.ts", () => {
  let values: string[] | null = null;
  let from: string | null = null;
  for (const name of migrations()) {
    const match = /ADD CONSTRAINT "User_role_check"\s*CHECK\s*\(\s*role IN \(([^)]*)\)\s*\)/.exec(statements(name));
    if (match) {
      values = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
      from = name;
    }
  }
  assert.equal(from, MIGRATION);
  assert.deepEqual(values, [...USER_ROLES]);
});

test("l'ancienne contrainte est retirée avant la conversion, la nouvelle posée après", () => {
  const sql = statements(MIGRATION);
  const drop = sql.indexOf('DROP CONSTRAINT "User_role_check"');
  const update = sql.search(/UPDATE "User"\s+SET role = 'GESTIONNAIRE'\s+WHERE role = 'MODERATOR'/);
  const add = sql.indexOf('ADD CONSTRAINT "User_role_check"');
  assert.ok(drop >= 0, "DROP CONSTRAINT absent");
  assert.ok(update > drop, "la conversion doit suivre le retrait de l'ancienne contrainte");
  assert.ok(add > update, "la nouvelle contrainte doit suivre la conversion");
});

test("le défaut passe à USER, en base comme dans schema.prisma", () => {
  assert.match(statements(MIGRATION), /ALTER COLUMN "role" SET DEFAULT 'USER'/);
  const model = /model User \{([\s\S]*?)\n\}/.exec(read(process.cwd(), "prisma", "schema.prisma"))?.[1] ?? "";
  assert.match(model, /\brole\s+String\s+@default\("USER"\)/);
});

test("la migration ne touche que la table User (le backend gelé ne la lit pas)", () => {
  const tables = new Set([...statements(MIGRATION).matchAll(/(?:ALTER TABLE|UPDATE|INSERT INTO|DELETE FROM)\s+"(\w+)"/g)].map((m) => m[1]));
  assert.deepEqual([...tables], ["User"]);
});
