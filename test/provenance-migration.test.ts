/**
 * test/provenance-migration.test.ts — La provenance du contenu, en base comme dans le code
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 5 : la migration `20261019120000_content_provenance`
 * ajoute à chacune des neuf tables de données (D10) l'auteur
 * (`updated_by_id`, clé vers `User` en `ON DELETE RESTRICT`, D24), la date
 * (`updated_at`) et l'origine (`updated_via`, D11), et le lien source aux
 * chiffres clés, aux accréditations et aux programmes (D12).
 *
 * Elle est additive et facultative partout (piège 5) : le backend gelé lit
 * ces tables (`SELECT *` de la Phase 2) sans les écrire, et ne touche ni
 * `PipelineJob` ni `ContributionInbox`, qu'il écrit. Les lignes existantes
 * restent « non suivies » : aucune valeur n'est inventée pour elles.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { UPDATE_ORIGINS } from "../lib/provenance";

const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");
const MIGRATION = "20261019120000_content_provenance";

const TABLES = [
  "School",
  "Campus",
  "Program",
  "PricingRecord",
  "CapacityRecord",
  "RankingRecord",
  "SchoolStatsRecord",
  "AccreditationRecord",
  "ProgramCampusAttachment",
];
const NEW_SOURCE_URL = ["SchoolStatsRecord", "AccreditationRecord", "Program"];

const read = (...parts: string[]) => fs.readFileSync(path.join(...parts), "utf-8").replace(/\r/g, "");

/** Les instructions SQL, sans les commentaires. */
const statements = () => read(MIGRATIONS, MIGRATION, "migration.sql").replace(/--.*$/gm, "");

const schema = () => read(process.cwd(), "prisma", "schema.prisma");
const model = (name: string) => new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`).exec(schema())?.[1] ?? "";

/** Les colonnes que la migration ajoute à `table`, avec leur définition. */
function addedColumns(table: string): Map<string, string> {
  const columns = new Map<string, string>();
  const sql = statements();
  for (const block of sql.matchAll(new RegExp(`ALTER TABLE "${table}"([\\s\\S]*?);`, "g"))) {
    for (const m of block[1].matchAll(/ADD COLUMN "(\w+)" ([^,]+)/g)) columns.set(m[1], m[2].trim());
  }
  return columns;
}

test("la migration existe et passe après celle de la liste blanche", () => {
  const all = fs
    .readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  assert.ok(all.includes(MIGRATION), MIGRATION);
  assert.ok(all.indexOf(MIGRATION) > all.indexOf("20261016150000_whitelist_accounts"));
});

test("elle est additive : ni DROP, ni RENAME, ni écriture de lignes", () => {
  const sql = statements();
  assert.equal(/DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|NOT NULL|DEFAULT)/i.test(sql), false, "suppression");
  assert.equal(/RENAME/i.test(sql), false, "renommage");
  assert.equal(/\b(UPDATE|INSERT INTO|DELETE FROM)\s+"/i.test(sql), false, "écriture de lignes");
  assert.equal(/SET NOT NULL|SET DEFAULT/i.test(sql), false, "colonne rendue obligatoire");
});

test("elle ne touche que les neuf tables de données, jamais celles qu'écrit le backend gelé", () => {
  const touched = new Set([...statements().matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]));
  assert.deepEqual([...touched].sort(), [...TABLES].sort());
  for (const backendTable of ["PipelineJob", "ContributionInbox", "User"]) assert.equal(touched.has(backendTable), false, backendTable);
});

test("chaque table reçoit l'auteur, la date et l'origine, facultatifs et sans valeur par défaut", () => {
  for (const table of TABLES) {
    const columns = addedColumns(table);
    assert.equal(columns.get("updated_at"), "TIMESTAMP(3)", `${table}.updated_at`);
    assert.equal(columns.get("updated_by_id"), "TEXT", `${table}.updated_by_id`);
    assert.equal(columns.get("updated_via"), "TEXT", `${table}.updated_via`);
  }
});

test("le lien source s'ajoute aux chiffres clés, aux accréditations et aux programmes (D12)", () => {
  for (const table of TABLES) {
    const columns = addedColumns(table);
    if (NEW_SOURCE_URL.includes(table)) assert.equal(columns.get("source_url"), "TEXT", table);
    else assert.equal(columns.has("source_url"), false, `${table} : source_url existe déjà ou n'est pas prévu`);
  }
});

test("l'auteur est une clé vers User, qui empêche de supprimer un compte auteur (D24)", () => {
  const sql = statements();
  for (const table of TABLES) {
    const fk = new RegExp(
      `ALTER TABLE "${table}"\\s+ADD CONSTRAINT "${table}_updated_by_id_fkey" FOREIGN KEY \\("updated_by_id"\\) REFERENCES "User"\\("id"\\) ON DELETE RESTRICT ON UPDATE CASCADE`
    );
    assert.match(sql, fk, table);
  }
});

test("l'origine est celle de lib/provenance.ts, et la provenance est complète ou absente", () => {
  const sql = statements();
  for (const table of TABLES) {
    const via = new RegExp(`ADD CONSTRAINT "${table}_updated_via_check"\\s*CHECK\\s*\\(\\s*updated_via IN \\(([^)]*)\\)\\s*\\)`).exec(sql);
    assert.ok(via, `${table}_updated_via_check absente`);
    assert.deepEqual([...via[1].matchAll(/'([^']+)'/g)].map((m) => m[1]), [...UPDATE_ORIGINS], table);
    assert.match(
      sql,
      new RegExp(
        `ADD CONSTRAINT "${table}_provenance_check"\\s*CHECK\\s*\\(\\s*\\(updated_at IS NULL\\) = \\(updated_by_id IS NULL\\)\\s+AND\\s+\\(updated_at IS NULL\\) = \\(updated_via IS NULL\\)\\s*\\)`
      ),
      `${table}_provenance_check`
    );
  }
});

test("schema.prisma décrit les mêmes colonnes et la même relation", () => {
  for (const table of TABLES) {
    const body = model(table);
    assert.match(body, /\bupdated_at\s+DateTime\?/, `${table}.updated_at`);
    assert.match(body, /\bupdated_by_id\s+String\?/, `${table}.updated_by_id`);
    assert.match(body, /\bupdated_via\s+String\?/, `${table}.updated_via`);
    assert.match(
      body,
      /\bupdatedBy\s+User\?\s+@relation\(fields: \[updated_by_id\], references: \[id\], onDelete: Restrict\)/,
      `${table}.updatedBy`
    );
    assert.doesNotMatch(body, /@updatedAt/, `${table} : la date est posée par le code, avec l'auteur`);
  }
  for (const table of NEW_SOURCE_URL) assert.match(model(table), /\bsource_url\s+String\?/, `${table}.source_url`);
  for (const backendTable of ["PipelineJob", "ContributionInbox"]) {
    assert.doesNotMatch(model(backendTable), /updated_by_id|updated_via|updatedBy/, backendTable);
  }
  // PipelineJob garde son updated_at : le battement de cœur du backend gelé.
  assert.match(model("PipelineJob"), /\bupdated_at\s+DateTime\s+@default\(now\(\)\)/);
});
