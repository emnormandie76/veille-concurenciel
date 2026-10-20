/**
 * test/manager-screens.test.ts — Les écrans du gestionnaire : qui a modifié, et le formulaire des chiffres clés
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 5, décisions du 20 octobre :
 * - D29 : chaque donnée des écrans de gestion d'une école (l'école, ses
 *   campus, programmes, tarifs, places, classements, chiffres clés et
 *   accréditations) montre « Modifié par … le … », le texte `last_edit` que
 *   rendent les routes (test/api/manager-provenance.test.ts), posé par
 *   `LastEdit` ;
 * - D30 : les pourcentages des chiffres clés acceptent toutes les décimales.
 *   La base en tient à deux (49,46) ; avec `step="0.1"`, le navigateur
 *   refusait d'envoyer le formulaire tant qu'on n'arrondissait pas.
 *
 * Les écrans sont des composants client qui lisent leurs données par `fetch` :
 * on vérifie leur source, et on rend `LastEdit` seul.
 */

import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Prisma } from "@prisma/client";

const DIR = "app/admin/schools/[id]";
let LastEdit: ComponentType<{ text: string | null | undefined }>;

before(async () => {
  ({ default: LastEdit } = (await import("../app/admin/schools/[id]/LastEdit")) as unknown as {
    default: ComponentType<{ text: string | null | undefined }>;
  });
});

test("LastEdit pose le texte, et rien pour une donnée d'avant le suivi", () => {
  const html = renderToStaticMarkup(createElement(LastEdit, { text: "Modifié par Camille Martin le 19 octobre 2026" }));
  assert.match(html, /Modifié par Camille Martin le 19 octobre 2026/);
  assert.equal(renderToStaticMarkup(createElement(LastEdit, { text: null })), "");
  assert.equal(renderToStaticMarkup(createElement(LastEdit, { text: undefined })), "");
});

/** Chaque écran, et le nombre de sortes de données dont il montre l'auteur. */
const SCREENS: Record<string, number> = {
  "manage/tabs/SchoolInfoTab.tsx": 1, // l'école
  "manage/tabs/CampusProgramsTab.tsx": 2, // les campus, les programmes
  "manage/tabs/PricingTab.tsx": 1,
  "manage/tabs/CapacitiesTab.tsx": 1,
  "manage/tabs/RankingsTab.tsx": 1,
  "manage/tabs/StatsTab.tsx": 1,
  "manage/tabs/AccreditationsTab.tsx": 1,
  "campuses/page.tsx": 1, // les campus
};

for (const [file, count] of Object.entries(SCREENS)) {
  test(`${file} : « Modifié par … le … » sur chaque donnée`, () => {
    const source = readFileSync(`${DIR}/${file}`, "utf8");
    assert.match(source, /import LastEdit from "[./]+\/LastEdit";/, `${file} : LastEdit importé`);
    const shown = source.match(/<LastEdit\s+text=\{[\w.?]+\.last_edit\}\s*\/>/g) ?? [];
    assert.equal(shown.length, count, `${file} : ${shown.length} donnée(s) avec leur auteur`);
    assert.match(source, /last_edit\??: string \| null;/, `${file} : last_edit dans le type des données`);
  });
}

test("D30 : chaque pourcentage des chiffres clés accepte toutes les décimales", () => {
  const source = readFileSync(`${DIR}/manage/tabs/StatsTab.tsx`, "utf8");
  const floats = Prisma.dmmf.datamodel.models
    .find((m) => m.name === "SchoolStatsRecord")!
    .fields.filter((f) => f.type === "Float")
    .map((f) => f.name);
  assert.deepEqual(floats.sort(), ["external_speakers_pct", "international_professors_pct"]);
  for (const field of floats) {
    // Le champ, de `<input` à `/>` (un `=>` de onChange interdit une regex simple).
    const at = source.indexOf(`id="${field}"`);
    assert.ok(at >= 0, `${field} : champ absent`);
    const input = source.slice(source.lastIndexOf("<input", at), source.indexOf("/>", at));
    assert.match(input, /type="number"/, field);
    assert.match(input, /step="any"/, `${field} : le pas bloque les valeurs à deux décimales`);
  }
});
