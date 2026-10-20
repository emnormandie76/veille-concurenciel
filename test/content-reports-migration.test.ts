/**
 * test/content-reports-migration.test.ts — La table des signalements, en base comme dans le code
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 6 : la migration `20261020120000_content_reports`
 * crée `ContentReport` (D13), et rien d'autre. Elle ne touche aucune table
 * existante, ni celles qu'écrit le backend gelé (`ContributionInbox`,
 * `PipelineJob`), ni les tables de données (piège 5) : les clés vers `User`,
 * `School`, `Campus` et `Program` sont posées sur la nouvelle table.
 *
 * Ses contraintes tiennent les mêmes listes et bornes que lib/content-reports.ts,
 * et ses clés disent les décisions : l'auteur et celui qui traite en
 * `RESTRICT` (D38, comme D24) ; l'école en `CASCADE`, le campus et le
 * programme en `SET NULL` (D37).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  MESSAGE_MAX_LENGTH,
  MESSAGE_MIN_LENGTH,
  REPORT_CATEGORIES,
  REPORT_STATUSES,
  RESPONSE_MAX_LENGTH,
  TARGET_TYPES,
} from "../lib/content-reports";

const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");
const MIGRATION = "20261020120000_content_reports";

const read = (...parts: string[]) => fs.readFileSync(path.join(...parts), "utf-8").replace(/\r/g, "");

/** Les instructions SQL, sans les commentaires. */
const statements = () => read(MIGRATIONS, MIGRATION, "migration.sql").replace(/--.*$/gm, "");

const schema = () => read(process.cwd(), "prisma", "schema.prisma");
const model = (name: string) => new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`).exec(schema())?.[1] ?? "";

/** Les valeurs d'une contrainte `CHECK ("colonne" IN (…))`. */
function checkedValues(constraint: string): string[] {
  const match = new RegExp(`"${constraint}" CHECK \\("\\w+" IN \\(([^)]*)\\)\\)`).exec(statements());
  assert.ok(match, constraint);
  return [...match[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
}

test("la migration existe et passe après celle de la provenance", () => {
  const all = fs
    .readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  assert.ok(all.includes(MIGRATION), MIGRATION);
  assert.ok(all.indexOf(MIGRATION) > all.indexOf("20261019120000_content_provenance"));
});

test("elle est additive : une table neuve, ni DROP, ni RENAME, ni écriture de lignes", () => {
  const sql = statements();
  assert.deepEqual([...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]), ["ContentReport"]);
  assert.equal(/\bDROP\b/i.test(sql), false, "suppression");
  assert.equal(/RENAME/i.test(sql), false, "renommage");
  assert.equal(/\b(UPDATE|INSERT INTO|DELETE FROM)\s+"/i.test(sql), false, "écriture de lignes");
});

test("elle ne modifie aucune table existante : les clés et index sont sur ContentReport", () => {
  const sql = statements();
  const altered = new Set([...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]));
  assert.deepEqual([...altered], ["ContentReport"]);
  for (const [, table] of sql.matchAll(/CREATE (?:UNIQUE )?INDEX "\w+" ON "(\w+)"/g)) assert.equal(table, "ContentReport");
});

test("piège 6 : rien ne passe par l'inbox, aucun statut de ticket", () => {
  const sql = statements();
  for (const word of ["ContributionInbox", "PipelineJob", "Pending_AI", "Pending_Admin"]) assert.equal(sql.includes(word), false, word);
});

test("les contraintes tiennent les listes de lib/content-reports.ts", () => {
  assert.deepEqual(checkedValues("ContentReport_category_check"), [...REPORT_CATEGORIES]);
  assert.deepEqual(checkedValues("ContentReport_status_check"), [...REPORT_STATUSES]);
  assert.deepEqual(checkedValues("ContentReport_target_type_check"), [...TARGET_TYPES]);
  assert.match(statements(), /"status" TEXT NOT NULL DEFAULT 'OPEN'/);
});

test("les bornes du message et de la réponse sont celles du code", () => {
  const sql = statements();
  assert.match(sql, new RegExp(`"ContentReport_message_check" CHECK \\(char_length\\("message"\\) BETWEEN ${MESSAGE_MIN_LENGTH} AND ${MESSAGE_MAX_LENGTH}\\)`));
  assert.match(sql, new RegExp(`"ContentReport_response_check" CHECK \\("response" IS NULL OR char_length\\("response"\\) <= ${RESPONSE_MAX_LENGTH}\\)`));
});

test("une cible à la fois, et un signalement fermé dit qui l'a traité et quand", () => {
  const sql = statements().replace(/\s+/g, " ");
  assert.match(sql, /"ContentReport_target_check" CHECK \( \("target_type" = 'SCHOOL' AND "campusId" IS NULL AND "programId" IS NULL\) OR \("target_type" = 'CAMPUS' AND "programId" IS NULL\) OR \("target_type" = 'PROGRAM' AND "campusId" IS NULL\) \)/);
  assert.match(sql, /"ContentReport_handled_check" CHECK \( \("status" = 'OPEN' AND "handled_by_id" IS NULL AND "handled_at" IS NULL AND "response" IS NULL\) OR \("status" <> 'OPEN' AND "handled_by_id" IS NOT NULL AND "handled_at" IS NOT NULL\) \)/);
});

test("D37, D38 : les clés et ce qu'elles font à la suppression", () => {
  const sql = statements().replace(/\s+/g, " ");
  const keys: Array<[string, string, string]> = [
    ["author_id", "User", "RESTRICT"],
    ["handled_by_id", "User", "RESTRICT"],
    ["schoolId", "School", "CASCADE"],
    ["campusId", "Campus", "SET NULL"],
    ["programId", "Program", "SET NULL"],
  ];
  for (const [column, table, action] of keys) {
    assert.match(
      sql,
      new RegExp(`ADD CONSTRAINT "ContentReport_${column}_fkey" FOREIGN KEY \\("${column}"\\) REFERENCES "${table}"\\("id"\\) ON DELETE ${action} ON UPDATE CASCADE;`),
      column,
    );
  }
  assert.equal([...sql.matchAll(/FOREIGN KEY/g)].length, keys.length);
});

test("schema.prisma décrit la même table et les mêmes clés", () => {
  const report = model("ContentReport");
  assert.ok(report, "model ContentReport");
  for (const field of ["author_id", "schoolId", "campusId", "programId", "target_type", "target_label", "category", "message", "source_url", "status", "response", "handled_by_id", "handled_at", "created_at"]) {
    assert.match(report, new RegExp(`\\n\\s+${field}\\s`), field);
  }
  assert.match(report, /status\s+String\s+@default\("OPEN"\)/);
  assert.match(report, /author\s+User\s+@relation\("ContentReportAuthor", fields: \[author_id\], references: \[id\], onDelete: Restrict\)/);
  assert.match(report, /handledBy\s+User\?\s+@relation\("ContentReportHandler", fields: \[handled_by_id\], references: \[id\], onDelete: Restrict\)/);
  assert.match(report, /school\s+School\s+@relation\(fields: \[schoolId\], references: \[id\], onDelete: Cascade\)/);
  assert.match(report, /campus\s+Campus\?\s+@relation\(fields: \[campusId\], references: \[id\], onDelete: SetNull\)/);
  assert.match(report, /program\s+Program\?\s+@relation\(fields: \[programId\], references: \[id\], onDelete: SetNull\)/);
  assert.match(model("User"), /reports\s+ContentReport\[\]\s+@relation\("ContentReportAuthor"\)/);
  assert.match(model("User"), /handledReports\s+ContentReport\[\]\s+@relation\("ContentReportHandler"\)/);
  for (const parent of ["School", "Campus", "Program"]) assert.match(model(parent), /contentReports\s+ContentReport\[\]/, parent);
  // Les tables qu'écrit le backend gelé ne connaissent pas les signalements.
  for (const backend of ["ContributionInbox", "PipelineJob"]) assert.equal(model(backend).includes("ContentReport"), false, backend);
});
