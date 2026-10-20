/**
 * test/research-launches-migration.test.ts — Le journal des lancements, en base comme dans le code
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 7 : la migration `20261020150000_research_launches`
 * crée `ResearchLaunch` (D14), et rien d'autre. `PipelineJob`, que le backend
 * gelé écrit, n'est pas touchée (piège 5) : ni colonne, ni clé vers elle (le
 * backend purge ses jobs, une clé gênerait sa purge). Une seule clé : le
 * lanceur vers `User`, en `RESTRICT` (D42, comme D24 et D38).
 *
 * `launched_at` prend l'heure de la base (`CURRENT_TIMESTAMP`), comme
 * `PipelineJob.started_at` que le backend écrit par `now()` : la fenêtre des
 * passes dues (D40) compare les deux. `@default(now())` donnerait l'heure du
 * poste, que le client Prisma 7 calcule lui-même.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { LAUNCH_DETAIL_MAX_LENGTH, LAUNCH_KINDS, LAUNCH_STATUSES } from "../lib/research-launches";
import { MAX_PASSES_PER_RUN } from "../lib/rotation-status";

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "prisma", "migrations");
const MIGRATION = "20261020150000_research_launches";

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

test("la migration existe et passe après celle des signalements", () => {
  const all = fs
    .readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  assert.ok(all.includes(MIGRATION), MIGRATION);
  assert.equal(all.indexOf(MIGRATION), all.indexOf("20261020120000_content_reports") + 1);
});

test("elle est additive : une table neuve, ni DROP, ni RENAME, ni écriture de lignes", () => {
  const sql = statements();
  assert.deepEqual([...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]), ["ResearchLaunch"]);
  assert.equal(/\bDROP\b/i.test(sql), false, "suppression");
  assert.equal(/RENAME/i.test(sql), false, "renommage");
  assert.equal(/\b(UPDATE|INSERT INTO|DELETE FROM)\s+"/i.test(sql), false, "écriture de lignes");
});

test("piège 5 : aucune table existante modifiée, rien vers les tables du backend gelé", () => {
  const sql = statements();
  const altered = new Set([...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]));
  assert.deepEqual([...altered], ["ResearchLaunch"]);
  for (const [, table] of sql.matchAll(/CREATE (?:UNIQUE )?INDEX "\w+" ON "(\w+)"/g)) assert.equal(table, "ResearchLaunch");
  for (const word of ["PipelineJob", "ContributionInbox", "Pending_AI"]) assert.equal(sql.includes(word), false, word);
});

test("les contraintes tiennent les listes de lib/research-launches.ts", () => {
  assert.deepEqual(checkedValues("ResearchLaunch_kind_check"), [...LAUNCH_KINDS]);
  assert.deepEqual(checkedValues("ResearchLaunch_status_check"), [...LAUNCH_STATUSES]);
  assert.match(statements(), /"status" TEXT NOT NULL DEFAULT 'PENDING'/);
  assert.match(
    statements(),
    new RegExp(`"ResearchLaunch_detail_check" CHECK \\("detail" IS NULL OR char_length\\("detail"\\) <= ${LAUNCH_DETAIL_MAX_LENGTH}\\)`)
  );
});

test("D40 : le nombre de passes borne la fenêtre, de 1 à 5, et n'existe que pour les passes dues", () => {
  assert.match(
    flat(),
    new RegExp(
      `"ResearchLaunch_max_passes_check" CHECK \\( \\("kind" = 'DUE_PASSES' AND "max_passes" BETWEEN 1 AND ${MAX_PASSES_PER_RUN}\\) OR \\("kind" = 'TARGETED' AND "max_passes" IS NULL\\) \\)`
    )
  );
});

test("D41 : une recherche ciblée partie porte l'id de son job ; un lancement en attente n'a pas encore de réponse", () => {
  const sql = flat();
  assert.match(
    sql,
    /"ResearchLaunch_job_check" CHECK \( \("kind" = 'DUE_PASSES' AND "job_id" IS NULL\) OR \("kind" = 'TARGETED' AND \("status" <> 'STARTED' OR "job_id" IS NOT NULL\)\) \)/
  );
  assert.match(
    sql,
    /"ResearchLaunch_answer_check" CHECK \( \("status" = 'PENDING' AND "http_status" IS NULL AND "job_id" IS NULL AND "detail" IS NULL\) OR \("status" <> 'PENDING' AND "http_status" BETWEEN 100 AND 599\) \)/
  );
});

test("D40 : l'heure du lancement est celle de la base, pas celle du poste", () => {
  assert.match(statements(), /"launched_at" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(model("ResearchLaunch"), /launched_at\s+DateTime\s+@default\(dbgenerated\("CURRENT_TIMESTAMP"\)\)/);
  assert.equal(/launched_at[^\n]*now\(\)/.test(model("ResearchLaunch")), false);
});

test("D42 : une seule clé, le lanceur vers User, en RESTRICT ; aucune clé vers PipelineJob", () => {
  const sql = flat();
  assert.match(
    sql,
    /ADD CONSTRAINT "ResearchLaunch_triggered_by_id_fkey" FOREIGN KEY \("triggered_by_id"\) REFERENCES "User"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE;/
  );
  assert.equal([...sql.matchAll(/FOREIGN KEY/g)].length, 1);
  assert.match(sql, /"triggered_by_id" TEXT NOT NULL/);
  assert.match(sql, /"job_id" TEXT,/);
});

test("schema.prisma décrit la même table, et PipelineJob ne change pas", () => {
  const launch = model("ResearchLaunch");
  assert.ok(launch, "model ResearchLaunch");
  for (const field of ["kind", "triggered_by_id", "launched_at", "status", "request", "max_passes", "job_id", "http_status", "detail"]) {
    assert.match(launch, new RegExp(`\\n\\s+${field}\\s`), field);
  }
  assert.match(launch, /status\s+String\s+@default\("PENDING"\)/);
  assert.match(launch, /request\s+Json\n/);
  assert.match(launch, /triggeredBy\s+User\s+@relation\(fields: \[triggered_by_id\], references: \[id\], onDelete: Restrict\)/);
  assert.match(model("User"), /researchLaunches\s+ResearchLaunch\[\]/);
  for (const frozen of ["PipelineJob", "ContributionInbox", "School"]) {
    assert.equal(/ResearchLaunch|triggered/.test(model(frozen)), false, frozen);
  }
});

/** Les fichiers TypeScript d'un dossier, récursivement. */
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

test("D14 : Next.js n'écrit jamais PipelineJob, la table du backend gelé", () => {
  const writes = /pipelineJob\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/;
  const offenders = [...sources(path.join(ROOT, "app")), ...sources(path.join(ROOT, "lib"))]
    .filter((file) => writes.test(fs.readFileSync(file, "utf-8")))
    .map((file) => path.relative(ROOT, file));
  assert.deepEqual(offenders, []);
});
