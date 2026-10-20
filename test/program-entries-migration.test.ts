/**
 * test/program-entries-migration.test.ts — Les admissions d'un programme, en base comme dans le code
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 8 : la migration `20261020180000_program_entries`
 * crée `ProgramEntry` (D16), une table fille de `Program`, et ne fait qu'une
 * chose de plus : elle élargit la contrainte des catégories de signalement à
 * `ADMISSIONS` (D52), sur `ContentReport`, que le backend gelé ne connaît pas.
 * `Program` n'est pas touchée (piège 5 : le diff de la Phase 2 la lit), ni
 * aucune table qu'écrit le backend.
 *
 * Ses contraintes tiennent les listes et bornes de lib/program-entries.ts
 * (D48) ; la provenance est celle des neuf tables de l'étape 5 (D49) : clé
 * `RESTRICT` vers `User` (D24), origine de lib/provenance.ts, trois colonnes
 * vides ensemble ou pleines ensemble.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { REPORT_CATEGORIES } from "../lib/content-reports";
import {
  ENTRY_ROUTES,
  ENTRY_YEAR_MAX,
  ENTRY_YEAR_MIN,
  NOTE_MAX_LENGTH,
  REQUIRED_LEVEL_MAX,
  REQUIRED_LEVEL_MIN,
} from "../lib/program-entries";
import { UPDATE_ORIGINS } from "../lib/provenance";

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "prisma", "migrations");
const MIGRATION = "20261020180000_program_entries";

const read = (...parts: string[]) => fs.readFileSync(path.join(...parts), "utf-8").replace(/\r/g, "");

/** Les instructions SQL, sans les commentaires. */
const statements = () => read(MIGRATIONS, MIGRATION, "migration.sql").replace(/--.*$/gm, "");
const flat = () => statements().replace(/\s+/g, " ");

const schema = () => read(ROOT, "prisma", "schema.prisma");
const model = (name: string) => new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`).exec(schema())?.[1] ?? "";

/** Les valeurs d'une contrainte `CHECK ("colonne" IN (…))`. */
function checkedValues(constraint: string): string[] {
  const match = new RegExp(`"${constraint}" CHECK \\("\\w+" IN \\(([^)]*)\\)\\)`).exec(statements());
  assert.ok(match, constraint);
  return [...match[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
}

test("la migration existe et passe après celle du journal des lancements", () => {
  const all = fs
    .readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  assert.ok(all.includes(MIGRATION), MIGRATION);
  assert.equal(all.indexOf(MIGRATION), all.indexOf("20261020150000_research_launches") + 1);
});

test("le fichier est en LF : son empreinte est celle que la base enregistrera", () => {
  const bytes = fs.readFileSync(path.join(MIGRATIONS, MIGRATION, "migration.sql"), "utf-8");
  assert.equal(bytes.includes("\r"), false);
});

test("elle est additive : une table neuve ; la seule suppression est celle de la contrainte qu'elle remplace (D52)", () => {
  const sql = statements();
  assert.deepEqual([...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]), ["ProgramEntry"]);
  assert.deepEqual(
    [...sql.matchAll(/\bDROP\b[^;]*;/gi)].map((m) => m[0].replace(/\s+/g, " ")),
    ['DROP CONSTRAINT "ContentReport_category_check";']
  );
  assert.equal(/RENAME/i.test(sql), false, "renommage");
  assert.equal(/\b(UPDATE|INSERT INTO|DELETE FROM)\s+"/i.test(sql), false, "écriture de lignes");
  assert.equal(/SET NOT NULL|SET DEFAULT|ADD COLUMN/i.test(sql), false, "colonne ajoutée ou rendue obligatoire");
});

test("piège 5 : ni Program ni les tables du backend gelé ne sont touchées", () => {
  const sql = statements();
  const altered = new Set([...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]));
  assert.deepEqual([...altered].sort(), ["ContentReport", "ProgramEntry"]);
  for (const [, table] of sql.matchAll(/CREATE (?:UNIQUE )?INDEX "\w+" ON "(\w+)"/g)) assert.equal(table, "ProgramEntry");
  for (const word of ["PipelineJob", "ContributionInbox", "Pending_AI", "admission_exam"]) assert.equal(sql.includes(word), false, word);
});

test("D52 : la contrainte des catégories est remplacée par la liste de lib/content-reports.ts, ADMISSIONS comprise", () => {
  const sql = flat();
  assert.match(sql, /ALTER TABLE "ContentReport" DROP CONSTRAINT "ContentReport_category_check"; ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_category_check" CHECK/);
  assert.deepEqual(checkedValues("ContentReport_category_check"), [...REPORT_CATEGORIES]);
  assert.ok(REPORT_CATEGORIES.includes("ADMISSIONS"));
});

test("D48 : les contraintes tiennent les listes et bornes de lib/program-entries.ts", () => {
  const sql = statements();
  assert.deepEqual(checkedValues("ProgramEntry_route_check"), [...ENTRY_ROUTES]);
  assert.match(sql, /"route" TEXT NOT NULL DEFAULT 'UNSPECIFIED'/);
  assert.match(sql, new RegExp(`"ProgramEntry_entry_year_check" CHECK \\("entry_year" BETWEEN ${ENTRY_YEAR_MIN} AND ${ENTRY_YEAR_MAX}\\)`));
  assert.match(sql, new RegExp(`"ProgramEntry_required_level_check" CHECK \\("required_level" BETWEEN ${REQUIRED_LEVEL_MIN} AND ${REQUIRED_LEVEL_MAX}\\)`));
  assert.match(sql, new RegExp(`"ProgramEntry_note_check" CHECK \\("note" IS NULL OR char_length\\("note"\\) <= ${NOTE_MAX_LENGTH}\\)`));
  assert.match(sql, /"entry_year" INTEGER NOT NULL/);
  assert.match(sql, /"required_level" INTEGER NOT NULL/);
});

test("D16 : une entrée par année, niveau et voie dans un programme", () => {
  assert.match(
    flat(),
    /CREATE UNIQUE INDEX "ProgramEntry_programId_entry_year_required_level_route_key" ON "ProgramEntry"\("programId", "entry_year", "required_level", "route"\);/
  );
});

test("D49 : la provenance des neuf tables, facultative, sous les deux contraintes de l'étape 5", () => {
  const sql = flat();
  assert.match(sql, /"updated_at" TIMESTAMP\(3\), "updated_by_id" TEXT, "updated_via" TEXT,/);
  assert.match(sql, /"source_url" TEXT,/);
  const via = /"ProgramEntry_updated_via_check" CHECK \(updated_via IN \(([^)]*)\)\)/.exec(sql);
  assert.ok(via, "ProgramEntry_updated_via_check");
  assert.deepEqual([...via[1].matchAll(/'([^']+)'/g)].map((m) => m[1]), [...UPDATE_ORIGINS]);
  assert.match(
    sql,
    /"ProgramEntry_provenance_check" CHECK \(\(updated_at IS NULL\) = \(updated_by_id IS NULL\) AND \(updated_at IS NULL\) = \(updated_via IS NULL\)\)/
  );
});

test("D24, D49 : deux clés, le programme en CASCADE, l'auteur en RESTRICT", () => {
  const sql = flat();
  assert.match(
    sql,
    /ALTER TABLE "ProgramEntry" ADD CONSTRAINT "ProgramEntry_programId_fkey" FOREIGN KEY \("programId"\) REFERENCES "Program"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE;/
  );
  assert.match(
    sql,
    /ALTER TABLE "ProgramEntry" ADD CONSTRAINT "ProgramEntry_updated_by_id_fkey" FOREIGN KEY \("updated_by_id"\) REFERENCES "User"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE;/
  );
  assert.equal([...sql.matchAll(/FOREIGN KEY/g)].length, 2);
});

test("schema.prisma décrit la même table, ses relations, et Program ne gagne qu'une relation", () => {
  const entry = model("ProgramEntry");
  assert.ok(entry, "model ProgramEntry");
  assert.match(entry, /\bentry_year\s+Int\n/);
  assert.match(entry, /\brequired_level\s+Int\n/);
  assert.match(entry, /\broute\s+String\s+@default\("UNSPECIFIED"\)/);
  assert.match(entry, /\bnote\s+String\?/);
  assert.match(entry, /\bsource_url\s+String\?/);
  assert.match(entry, /\bprogram\s+Program\s+@relation\(fields: \[programId\], references: \[id\], onDelete: Cascade\)/);
  assert.match(entry, /\bupdated_at\s+DateTime\?/);
  assert.match(entry, /\bupdated_by_id\s+String\?/);
  assert.match(entry, /\bupdated_via\s+String\?/);
  assert.match(entry, /\bupdatedBy\s+User\?\s+@relation\(fields: \[updated_by_id\], references: \[id\], onDelete: Restrict\)/);
  assert.match(entry, /@@unique\(\[programId, entry_year, required_level, route\]\)/);
  assert.doesNotMatch(entry, /@updatedAt/, "la date est posée par le code, avec l'auteur");

  assert.match(model("Program"), /\bentries\s+ProgramEntry\[\]/);
  assert.match(model("User"), /\bupdatedProgramEntries\s+ProgramEntry\[\]/);
  // admission_exam reste tel quel (D47).
  assert.match(model("Program"), /\badmission_exam\s+String\?/);
  for (const frozen of ["PipelineJob", "ContributionInbox"]) assert.equal(model(frozen).includes("ProgramEntry"), false, frozen);
});
