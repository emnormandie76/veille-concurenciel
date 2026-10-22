/**
 * La garde qui empêche de clôturer à vide un rapport Research rangé.
 *
 * La Phase 1 range en `Failed` le rapport d'une extraction échouée, pour que sa
 * prochaine passe le reprenne sans repayer Research. Valider ce ticket depuis
 * l'Inbox le clôturerait sans rien écrire, et le rapport ne serait plus repris.
 *
 * Et les listes de la zone tampon contre la base. Depuis l'étape 11 du plan
 * gestion-contenu (D101), le backend Python ne vit plus que sur la branche
 * `local`, avec `test/test_contribution_enums.py`, qui tenait ensemble ses
 * listes, celles de lib/contribution.ts et les contraintes CHECK de
 * `ContributionInbox`. Ici, la part qui reste vraie sur cette branche : les
 * listes TypeScript, avec lesquelles l'inbox filtre, contre les contraintes
 * que le backend de `local` respecte en écrivant la table partagée.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  CONTRIBUTION_CATEGORIES,
  CONTRIBUTION_SOURCE_TYPES,
  CONTRIBUTION_STATUSES,
  PARKED_RESEARCH_REPORT,
  PUBLIC_CONTRIBUTION_CATEGORIES,
  isParkedResearchReport,
} from "../lib/contribution";

test("reconnaît la charge d'un rapport rangé", () => {
  assert.equal(
    isParkedResearchReport({ parked_reason: PARKED_RESEARCH_REPORT, last_error: "503", extraction_attempts: 2 }),
    true,
  );
});

test("ne confond pas un ticket de découverte ordinaire", () => {
  assert.equal(isParkedResearchReport({ discovered_campuses: [] }), false);
  assert.equal(isParkedResearchReport({ parked_reason: "autre chose" }), false);
});

test("tolère les charges absentes ou d'une autre forme", () => {
  for (const json of [null, undefined, "research_report_parked", 42, [PARKED_RESEARCH_REPORT]]) {
    assert.equal(isParkedResearchReport(json), false, String(json));
  }
});

test("garde la valeur qu'écrit le pipeline Python de la branche local", () => {
  // `PARKED_REPORT_REASON` de backend/pipeline/phase1_research.py, que ce test
  // lisait tant que le backend était sur la branche (étape 11, D101).
  assert.equal(PARKED_RESEARCH_REPORT, "research_report_parked");
});

// ── Les listes de la zone tampon contre la base (étape 11) ─────────────

const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");
const ENUM_GUARDS = "20260902120000_inbox_relations_and_enum_guards";
const ENUM_CONSTRAINTS = [
  "ContributionInbox_status_check",
  "ContributionInbox_ai_category_check",
  "ContributionInbox_source_type_check",
];

/** Les valeurs d'une contrainte `CHECK (colonne IN (…))` de la migration des garde-fous. */
function checkedValues(constraint: string): string[] {
  const sql = fs.readFileSync(path.join(MIGRATIONS, ENUM_GUARDS, "migration.sql"), "utf-8");
  const match = new RegExp(`ADD CONSTRAINT "${constraint}"\\s*CHECK \\(\\w+ IN \\(([^)]*)\\)\\)`).exec(sql);
  assert.ok(match, constraint);
  return [...match[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
}

const sorted = (values: readonly string[]) => [...values].sort();

test("les statuts, catégories et origines de lib/contribution.ts sont ceux des contraintes de ContributionInbox", () => {
  assert.deepEqual(sorted(checkedValues("ContributionInbox_status_check")), sorted(CONTRIBUTION_STATUSES));
  assert.deepEqual(sorted(checkedValues("ContributionInbox_ai_category_check")), sorted(CONTRIBUTION_CATEGORIES));
  assert.deepEqual(sorted(checkedValues("ContributionInbox_source_type_check")), sorted(CONTRIBUTION_SOURCE_TYPES));
});

test("aucune autre migration ne pose ni ne remplace ces contraintes", () => {
  const others = fs
    .readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== ENUM_GUARDS)
    .filter((entry) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS, entry.name, "migration.sql"), "utf-8");
      return ENUM_CONSTRAINTS.some((name) => sql.includes(name));
    })
    .map((entry) => entry.name);
  assert.deepEqual(others, []);
});

test("les catégories publiques sont des catégories, sans Program_Discovery", () => {
  const all: readonly string[] = CONTRIBUTION_CATEGORIES;
  for (const category of PUBLIC_CONTRIBUTION_CATEGORIES) assert.ok(all.includes(category), category);
  assert.ok(PUBLIC_CONTRIBUTION_CATEGORIES.length < CONTRIBUTION_CATEGORIES.length);
  assert.equal((PUBLIC_CONTRIBUTION_CATEGORIES as readonly string[]).includes("Program_Discovery"), false);
});
