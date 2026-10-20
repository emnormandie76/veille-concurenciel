/**
 * test/program-entries.test.ts — Les admissions d'un programme : les listes, la lecture d'un envoi, le texte
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 8 (doc « Plan d'évolution » : « Année d'entrée
 * d'un programme : avec quel diplôme on peut y entrer ») :
 * - D16 : une ligne par entrée possible (`ProgramEntry`) ;
 * - D48 : des listes fermées : année d'entrée de 1 à 5, niveau requis de 0
 *   (Bac) à 5 (Bac+5), cinq voies ; une note de 500 caractères au plus ;
 * - D49 : le lien source suit la règle D27 (`readSourceUrl`) ;
 * - D51 : le texte affiché (« Entrée en 1re année avec le Bac, par
 *   Parcoursup ») vient de ce module, sans style.
 *
 * La migration tient les mêmes listes et bornes
 * (test/program-entries-migration.test.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DUPLICATE_ENTRY_ERROR,
  ENTRY_ORDER_BY,
  ENTRY_ROUTES,
  ENTRY_YEAR_MAX,
  ENTRY_YEAR_MIN,
  NOTE_MAX_LENGTH,
  REQUIRED_LEVEL_MAX,
  REQUIRED_LEVEL_MIN,
  ROUTE_LABELS,
  describeEntry,
  entryYearLabel,
  levelLabel,
  readEntry,
  routeLabel,
} from "../lib/program-entries";
import { SOURCE_URL_ERROR } from "../lib/provenance";

const valid = (overrides: Record<string, unknown> = {}) => ({
  entry_year: 1,
  required_level: 0,
  route: "PARCOURSUP",
  note: "",
  source_url: "",
  ...overrides,
});

// ─── Les listes (D48) ───────────────────────────────────────────────────────

test("D48 : année d'entrée de 1 à 5, niveau requis de 0 (Bac) à 5 (Bac+5), cinq voies", () => {
  assert.equal(ENTRY_YEAR_MIN, 1);
  assert.equal(ENTRY_YEAR_MAX, 5);
  assert.equal(REQUIRED_LEVEL_MIN, 0);
  assert.equal(REQUIRED_LEVEL_MAX, 5);
  assert.deepEqual([...ENTRY_ROUTES], ["PARCOURSUP", "EXAM", "TITLE", "INTERNATIONAL", "UNSPECIFIED"]);
  assert.deepEqual(Object.keys(ROUTE_LABELS), [...ENTRY_ROUTES]);
  assert.deepEqual(ROUTE_LABELS, {
    PARCOURSUP: "Parcoursup",
    EXAM: "Concours",
    TITLE: "Admission sur titre",
    INTERNATIONAL: "Candidats internationaux",
    UNSPECIFIED: "Non précisée",
  });
  assert.equal(NOTE_MAX_LENGTH, 500);
});

test("les libellés : « 1re année », « 3e année » ; « Bac », « Bac+2 » ; une voie inconnue reste lisible", () => {
  assert.equal(entryYearLabel(1), "1re année");
  assert.equal(entryYearLabel(3), "3e année");
  assert.equal(levelLabel(0), "Bac");
  assert.equal(levelLabel(2), "Bac+2");
  assert.equal(levelLabel(5), "Bac+5");
  assert.equal(routeLabel("EXAM"), "Concours");
  assert.equal(routeLabel("AUTRE"), "AUTRE");
});

test("l'ordre d'affichage : l'année d'entrée, puis le niveau, puis la voie", () => {
  assert.deepEqual(ENTRY_ORDER_BY, [{ entry_year: "asc" }, { required_level: "asc" }, { route: "asc" }]);
});

// ─── Le texte (D51) ─────────────────────────────────────────────────────────

test("describeEntry : l'année, le niveau, puis la voie quand elle est connue", () => {
  assert.equal(describeEntry({ entry_year: 1, required_level: 0, route: "PARCOURSUP" }), "Entrée en 1re année avec le Bac, par Parcoursup");
  assert.equal(describeEntry({ entry_year: 3, required_level: 2, route: "EXAM" }), "Entrée en 3e année avec un Bac+2, sur concours");
  assert.equal(describeEntry({ entry_year: 1, required_level: 3, route: "TITLE" }), "Entrée en 1re année avec un Bac+3, sur titre");
  assert.equal(
    describeEntry({ entry_year: 1, required_level: 0, route: "INTERNATIONAL" }),
    "Entrée en 1re année avec le Bac, pour les candidats internationaux"
  );
  assert.equal(describeEntry({ entry_year: 2, required_level: 4, route: "UNSPECIFIED" }), "Entrée en 2e année avec un Bac+4");
  assert.equal(describeEntry({ entry_year: 2, required_level: 4, route: "INCONNUE" }), "Entrée en 2e année avec un Bac+4");
});

// ─── Lire un envoi ──────────────────────────────────────────────────────────

test("readEntry : un envoi complet ; la note et le lien vides deviennent null", () => {
  assert.deepEqual(readEntry(valid()), {
    ok: true,
    value: { entry_year: 1, required_level: 0, route: "PARCOURSUP", note: null, source_url: null },
  });
  assert.deepEqual(
    readEntry(valid({ entry_year: "3", required_level: "2", route: "EXAM", note: "  Concours Passerelle 1  ", source_url: " https://www.passerelle-esc.com " })),
    {
      ok: true,
      value: { entry_year: 3, required_level: 2, route: "EXAM", note: "Concours Passerelle 1", source_url: "https://www.passerelle-esc.com" },
    }
  );
});

test("readEntry : une voie absente ou vide est « non précisée »", () => {
  for (const route of [undefined, null, ""]) {
    const read = readEntry(valid({ route }));
    assert.ok(read.ok, String(route));
    assert.equal(read.value.route, "UNSPECIFIED");
  }
});

test("readEntry : l'année d'entrée est un entier de 1 à 5", () => {
  for (const year of [1, 5, "2"]) assert.equal(readEntry(valid({ entry_year: year })).ok, true, String(year));
  for (const year of [0, 6, -1, 1.5, "1.5", "deux", "", null, undefined, true, [1]]) {
    const read = readEntry(valid({ entry_year: year }));
    assert.equal(read.ok, false, String(year));
    if (!read.ok) assert.match(read.error, /année d'entrée/);
  }
});

test("readEntry : le niveau requis va du Bac (0) à Bac+5 (5)", () => {
  for (const level of [0, 5, "3"]) assert.equal(readEntry(valid({ required_level: level })).ok, true, String(level));
  for (const level of [-1, 6, 2.5, "Bac+2", "", null, undefined]) {
    const read = readEntry(valid({ required_level: level }));
    assert.equal(read.ok, false, String(level));
    if (!read.ok) assert.match(read.error, /niveau requis/);
  }
});

test("readEntry : une voie hors de la liste est refusée", () => {
  for (const route of ["parcoursup", "AST", "OTHER", 3]) {
    const read = readEntry(valid({ route }));
    assert.equal(read.ok, false, String(route));
    if (!read.ok) assert.match(read.error, /voie/);
  }
});

test("readEntry : la note fait 500 caractères au plus, comptés comme Postgres", () => {
  assert.equal(readEntry(valid({ note: "x".repeat(500) })).ok, true);
  assert.equal(readEntry(valid({ note: "x".repeat(501) })).ok, false);
  // 500 émojis : 1 000 unités UTF-16, mais 500 caractères pour char_length.
  assert.equal(readEntry(valid({ note: "🎓".repeat(500) })).ok, true);
  assert.equal(readEntry(valid({ note: 42 })).ok, false);
});

test("readEntry : le lien source suit la règle D27", () => {
  for (const bad of ["javascript:alert(1)", "www.ecole.fr", 42]) {
    assert.deepEqual(readEntry(valid({ source_url: bad })), { ok: false, error: SOURCE_URL_ERROR }, String(bad));
  }
});

test("readEntry : ni l'auteur, ni le programme, ni l'identifiant ne viennent du corps", () => {
  const read = readEntry(
    valid({ programId: "autre-programme", id: "autre-entree", updated_by_id: "intrus", updated_via: "REPORT", updated_at: "2000-01-01" })
  );
  assert.ok(read.ok);
  assert.deepEqual(Object.keys(read.value).sort(), ["entry_year", "note", "required_level", "route", "source_url"]);
});

test("le message d'un doublon dit que rien n'a été écrit", () => {
  assert.match(DUPLICATE_ENTRY_ERROR, /existe déjà/);
  assert.match(DUPLICATE_ENTRY_ERROR, /Rien n'a été écrit/);
});
