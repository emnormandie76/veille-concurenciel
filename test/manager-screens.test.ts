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
 * Étape 9, lot 2 (reprise graphique) : la liste des écoles, la page des
 * campus, le cadre de la gestion et les onglets Infos, Accréditations,
 * Chiffres clés et Admissions passent à la charte ; les quatre autres
 * onglets restent à l'ancien style jusqu'au lot 3, hors du sous-arbre
 * `.charte` (D60), avec une copie à l'ancien style des pièces partagées
 * (D61). Le confirm() des chiffres clés devient un dialogue (D63),
 * l'interrupteur des accréditations une case à cocher (D64), le badge de
 * statut d'une école suit le statut (D66).
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

import { SCHOOL_STATUS_TONES, schoolStatusTone } from "../app/admin/schools/school-status";

const DIR = "app/admin/schools/[id]";
const read = (file: string) => readFileSync(file, "utf8").replace(/\r/g, "");
/** Le code seul, sans les commentaires (un commentaire peut nommer ce que le code n'a plus). */
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

type LastEditComponent = ComponentType<{ text: string | null | undefined }>;
let LastEdit: LastEditComponent;
let LegacyLastEdit: LastEditComponent;

before(async () => {
  ({ default: LastEdit } = (await import("../app/admin/schools/[id]/LastEdit")) as unknown as { default: LastEditComponent });
  ({ default: LegacyLastEdit } = (await import("../app/admin/schools/[id]/manage/legacy/LastEdit")) as unknown as {
    default: LastEditComponent;
  });
});

test("LastEdit pose le texte, et rien pour une donnée d'avant le suivi", () => {
  // Étape 9, lot 2 (D61) : la version de la charte, et la copie à l'ancien
  // style des onglets du lot 3, disent la même chose.
  for (const component of [LastEdit, LegacyLastEdit]) {
    const html = renderToStaticMarkup(createElement(component, { text: "Modifié par Camille Martin le 19 octobre 2026" }));
    assert.match(html, /Modifié par Camille Martin le 19 octobre 2026/);
    assert.equal(renderToStaticMarkup(createElement(component, { text: null })), "");
    assert.equal(renderToStaticMarkup(createElement(component, { text: undefined })), "");
  }
  assert.match(renderToStaticMarkup(createElement(LastEdit, { text: "x" })), /^<p class="[^"]*text-ink-2[^"]*">x<\/p>$/, "dans la charte");
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
  "manage/tabs/AdmissionsTab.tsx": 1, // les entrées d'un programme (étape 8, D49)
  "campuses/page.tsx": 1, // les campus
};

/**
 * Étape 9, D60 et D61 : jusqu'au lot 3, ces quatre onglets restent à l'ancien
 * style et prennent la copie de manage/legacy/ ; eux seuls. Le lot 3 vide
 * cette liste.
 */
const LEGACY_UNTIL_LOT_3 = new Set([
  "manage/tabs/CampusProgramsTab.tsx",
  "manage/tabs/PricingTab.tsx",
  "manage/tabs/CapacitiesTab.tsx",
  "manage/tabs/RankingsTab.tsx",
]);

for (const [file, count] of Object.entries(SCREENS)) {
  test(`${file} : « Modifié par … le … » sur chaque donnée`, () => {
    const source = read(`${DIR}/${file}`);
    // L'attendu change avec la règle (D61) : « [./]+/LastEdit » pour tous
    // jusqu'au lot 2 ; la copie de manage/legacy/ pour les onglets du lot 3.
    const importLine = LEGACY_UNTIL_LOT_3.has(file)
      ? /import LastEdit from "\.\.\/legacy\/LastEdit";/
      : /import LastEdit from "[./]+\/LastEdit";/;
    assert.match(source, importLine, `${file} : LastEdit importé`);
    const shown = source.match(/<LastEdit\s+text=\{[\w.?]+\.last_edit\}\s*\/>/g) ?? [];
    assert.equal(shown.length, count, `${file} : ${shown.length} donnée(s) avec leur auteur`);
    assert.match(source, /last_edit\??: string \| null;/, `${file} : last_edit dans le type des données`);
  });
}

test("D61 : seuls les onglets du lot 3 prennent les copies de manage/legacy/, et elles restent à l'ancien style", () => {
  for (const file of Object.keys(SCREENS)) {
    const source = read(`${DIR}/${file}`);
    assert.equal(/from "\.\.\/legacy\//.test(source), LEGACY_UNTIL_LOT_3.has(file), file);
  }
  for (const piece of ["ProgramSelector", "YearSelector"]) {
    assert.doesNotMatch(read(`${DIR}/manage/components/${piece}.tsx`), /className="(btn|form-control|year-selector)/, `${piece} : dans la charte`);
    assert.match(read(`${DIR}/manage/legacy/${piece}.tsx`), /className="form-control"/, `${piece} : la copie garde l'ancien style`);
  }
});

test("D60 : les onglets du lot 3, hors du gabarit de la charte, dans l'îlot sombre", () => {
  const page = read(`${DIR}/manage/page.tsx`);
  const legacy = [...page.matchAll(/\{ key: "([\w-]+)", label: "[^"]+", legacy: true \}/g)].map((m) => m[1]);
  assert.deepEqual(legacy.sort(), ["campus-programs", "capacities", "pricing", "rankings"]);
  assert.match(page, /import TabFrame from "\.\/legacy\/TabFrame";/);
  assert.match(page, /legacy \? <TabFrame>\{renderTab\(key\)\}<\/TabFrame> : renderTab\(key\)/);
  // Les panneaux de l'ancien style se posent après le gabarit, pas dedans.
  const end = page.indexOf("</AdminPage>");
  assert.ok(end > 0);
  assert.ok(page.indexOf("TABS.filter((tab) => tab.legacy).map(panel)") > end, "après </AdminPage>");
  assert.ok(page.indexOf("TABS.filter((tab) => !tab.legacy).map(panel)") < end, "les autres dans le gabarit");
  // L'îlot rend le fond sombre du back-office : l'ancien style, hors des @source.
  assert.match(read(`${DIR}/manage/legacy/TabFrame.tsx`), /backgroundColor: "var\(--bg-primary\)"/);
});

test("D50, D51 : l'onglet « Admissions » lit l'école, écrit chaque entrée, prend ses listes à lib/program-entries.ts", () => {
  const source = read(`${DIR}/manage/tabs/AdmissionsTab.tsx`);
  assert.match(source, /fetch\(`\/api\/admin\/schools\/\$\{schoolId\}\/entries/);
  assert.match(source, /`\/api\/admin\/programs\/\$\{[\w.]+\}\/entries`/);
  assert.match(source, /`\/api\/admin\/program-entries\/\$\{[\w.]+\}`/);
  assert.match(source, /from "@\/lib\/program-entries"/);
  assert.match(source, /ENTRY_ROUTES\.map/, "les voies viennent de la liste de référence");
  assert.match(source, /sourceHref\(/, "seul un lien http(s) est cliquable (D27)");
  // L'attendu change avec la règle (G7, étape 9, lot 2) : l'ancien style de
  // l'écran (D51) jusque-là, sans composant ; désormais la charte, avec les
  // dialogues natifs à la place des fenêtres `modal-overlay`.
  assert.match(source, /from "@\/components\/ui\/Dialog"/);
  assert.doesNotMatch(source, /modal-overlay/);

  const page = read(`${DIR}/manage/page.tsx`);
  assert.match(page, /import AdmissionsTab from "\.\/tabs\/AdmissionsTab";/);
  assert.match(page, /\{ key: "admissions", label: "Admissions",/);
  assert.match(page, /<AdmissionsTab schoolId=\{schoolId\} \/>/);
  assert.match(page, /school\._counts\.programEntries/);
});

test("D30 : chaque pourcentage des chiffres clés accepte toutes les décimales", () => {
  const source = read(`${DIR}/manage/tabs/StatsTab.tsx`);
  const floats = Prisma.dmmf.datamodel.models
    .find((m) => m.name === "SchoolStatsRecord")!
    .fields.filter((f) => f.type === "Float")
    .map((f) => f.name);
  assert.deepEqual(floats.sort(), ["external_speakers_pct", "international_professors_pct"]);
  for (const field of floats) {
    // L'attendu suit la charte (étape 9, lot 2) : l'identifiant est porté par
    // `Field`, qui le passe au contrôle ; le champ va de `<Input` à `/>` (un
    // `=>` de onChange interdit une regex simple). C'était `<input id=…`.
    const at = source.indexOf(`<Field id="${field}"`);
    assert.ok(at >= 0, `${field} : champ absent`);
    const start = source.indexOf("<Input", at);
    assert.ok(start > at && start < source.indexOf("</Field>", at), `${field} : un <Input> dans son Field`);
    const input = source.slice(start, source.indexOf("/>", start));
    assert.match(input, /\{\.\.\.control\}/, `${field} : relié à son libellé`);
    assert.match(input, /type="number"/, field);
    assert.match(input, /step="any"/, `${field} : le pas bloque les valeurs à deux décimales`);
  }
});

test("D63 : supprimer une année de chiffres clés se confirme dans le dialogue de la charte, plus par confirm()", () => {
  const source = code(`${DIR}/manage/tabs/StatsTab.tsx`);
  assert.doesNotMatch(source, /\bconfirm\(/);
  assert.match(source, /from "@\/components\/ui\/Dialog"/);
  assert.match(source, /title=\{`Supprimer les statistiques pour l'année \$\{selectedYear\} \?`\}/, "le texte de l'ancienne fenêtre");
  assert.match(source, /onClick=\{\(\) => setConfirmDelete\(true\)\}/);
});

test("D64 : le statut d'une accréditation est une case à cocher native, libellée", () => {
  const source = read(`${DIR}/manage/tabs/AccreditationsTab.tsx`);
  assert.doesNotMatch(source, /toggle-switch|toggle-container/);
  assert.match(source, /<legend[^>]*>Statut de l&apos;accréditation<\/legend>/);
  assert.match(source, /<input\s+id="acc-active"\s+type="checkbox"/);
  assert.match(source, /checked=\{formIsActive\}/);
  assert.match(source, /<label htmlFor="acc-active"[^>]*>\s*Accréditation encore active\s*<\/label>/);
});

test("D66 : le badge de statut d'une école suit le statut, sur la liste comme dans la gestion", () => {
  assert.deepEqual(SCHOOL_STATUS_TONES, { ACTIVE: "success", INACTIVE: "neutral", DRAFT: "warning" });
  assert.equal(schoolStatusTone("ARCHIVED"), "neutral", "un statut inconnu reste neutre");
  for (const file of ["app/admin/schools/page.tsx", `${DIR}/manage/page.tsx`]) {
    assert.match(read(file), /<Badge tone=\{schoolStatusTone\(school\.status\)\}>\{school\.status\}<\/Badge>/, file);
  }
});
