/**
 * test/accounts-migration.test.ts — La liste blanche, en base comme dans le code
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 2 : la migration `20261016150000_whitelist_accounts`
 * ajoute à `User` l'adresse (unique), le nom affiché, l'état (invité, actif,
 * désactivé), la date de première connexion et la version de session (D20) ;
 * `username` et `password_hash` deviennent facultatifs (D3, G5).
 *
 * Elle est additive : rien n'est supprimé ni renommé, aucune autre table n'est
 * touchée (le backend gelé ne lit pas `User`, mais ses tests restent le filet).
 * Les comptes existants deviennent « actifs » ; tout compte créé ensuite est
 * « invité » par défaut. Ce test lie la contrainte d'état à `ACCOUNT_STATUSES`
 * (lib/accounts.ts) et le SQL à `schema.prisma`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ACCOUNT_STATUSES } from "../lib/accounts";

const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");
const MIGRATION = "20261016150000_whitelist_accounts";

const read = (...parts: string[]) => fs.readFileSync(path.join(...parts), "utf-8");

/** Les instructions SQL, sans les commentaires. */
const statements = () => read(MIGRATIONS, MIGRATION, "migration.sql").replace(/--.*$/gm, "");

const userModel = () =>
  /model User \{([\s\S]*?)\n\}/.exec(read(process.cwd(), "prisma", "schema.prisma"))?.[1] ?? "";

test("la migration de la liste blanche existe et passe après celle des trois rôles", () => {
  const all = fs
    .readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  assert.ok(all.includes(MIGRATION), MIGRATION);
  assert.ok(all.indexOf(MIGRATION) > all.indexOf("20261016120000_three_roles"));
});

test("elle est additive : ni DROP de table, de colonne ou de contrainte, ni RENAME, ni DELETE", () => {
  const sql = statements();
  assert.equal(/DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)/i.test(sql), false, "suppression");
  assert.equal(/RENAME/i.test(sql), false, "renommage");
  assert.equal(/DELETE\s+FROM/i.test(sql), false, "suppression de lignes");
});

test("elle ne touche que la table User", () => {
  const tables = new Set(
    [...statements().matchAll(/(?:ALTER TABLE|UPDATE|INSERT INTO|DELETE FROM|ON)\s+"(\w+)"/g)].map((m) => m[1])
  );
  assert.deepEqual([...tables], ["User"]);
});

test("les colonnes ajoutées, et les deux qui deviennent facultatives", () => {
  const sql = statements();
  for (const column of [
    /ADD COLUMN "email" TEXT\b(?! NOT NULL)/,
    /ADD COLUMN "display_name" TEXT\b(?! NOT NULL)/,
    /ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE'/,
    /ADD COLUMN "first_login_at" TIMESTAMP\(3\)(?! NOT NULL)/,
    /ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0/,
  ]) {
    assert.match(sql, column);
  }
  assert.match(sql, /ALTER COLUMN "username" DROP NOT NULL/);
  assert.match(sql, /ALTER COLUMN "password_hash" DROP NOT NULL/);
  assert.match(sql, /CREATE UNIQUE INDEX "User_email_key" ON "User"\("email"\)/);
});

test("les comptes existants deviennent actifs ; un compte créé ensuite est invité", () => {
  const sql = statements();
  const added = sql.search(/ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE'/);
  const invited = sql.search(/ALTER COLUMN "status" SET DEFAULT 'INVITED'/);
  assert.ok(added >= 0 && invited > added, "le défaut INVITED se pose après le remplissage ACTIVE");
  assert.match(userModel(), /\bstatus\s+String\s+@default\("INVITED"\)/);
});

test("la contrainte d'état est celle de lib/accounts.ts", () => {
  const match = /ADD CONSTRAINT "User_status_check"\s*CHECK\s*\(\s*status IN \(([^)]*)\)\s*\)/.exec(statements());
  assert.ok(match, "User_status_check absente");
  assert.deepEqual([...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]), [...ACCOUNT_STATUSES]);
});

test("les invariants dont dépend le code sont tenus par la base", () => {
  const sql = statements();
  // Un compte actif a un mot de passe, et lui seul (connexion, D4, D21).
  assert.match(sql, /ADD CONSTRAINT "User_password_status_check"\s*CHECK\s*\(\s*\(status = 'ACTIVE'\) = \(password_hash IS NOT NULL\)\s*\)/);
  // Un invité a une adresse : sans elle, pas de première connexion (D3).
  assert.match(sql, /ADD CONSTRAINT "User_invited_email_check"\s*CHECK\s*\(\s*status <> 'INVITED' OR email IS NOT NULL\s*\)/);
  // Tout compte a de quoi se connecter un jour : une adresse ou l'ancien identifiant.
  assert.match(sql, /ADD CONSTRAINT "User_identity_check"\s*CHECK\s*\(\s*email IS NOT NULL OR username IS NOT NULL\s*\)/);
  // L'unicité ne vaut que sur une forme unique : les minuscules (lib/accounts.ts).
  assert.match(sql, /ADD CONSTRAINT "User_email_lower_check"\s*CHECK\s*\(\s*email = lower\(email\)\s*\)/);
});

test("schema.prisma décrit les mêmes colonnes", () => {
  const model = userModel();
  for (const field of [
    /\busername\s+String\?\s+@unique/,
    /\bemail\s+String\?\s+@unique/,
    /\bdisplay_name\s+String\?/,
    /\bpassword_hash\s+String\?/,
    /\bfirst_login_at\s+DateTime\?/,
    /\bsession_version\s+Int\s+@default\(0\)/,
  ]) {
    assert.match(model, field);
  }
});
