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
 * Étape 9, lot 3 : les onglets Campus & Programmes, Tarifs, Classements et
 * Capacités passent à la charte ; l'îlot (D60) et les copies (D61) sont
 * retirés. Le podium d'un classement en tons de catégorie (D68), les
 * interrupteurs d'un programme en cases à cocher (D69), la modification
 * rapide des places au clavier (D71), le lien « Source » en http(s) (D72),
 * le confirm() des tarifs en dialogue (D63).
 *
 * Les écrans sont des composants client qui lisent leurs données par `fetch` :
 * on vérifie leur source, et on rend `LastEdit` seul.
 */

import { before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Prisma } from "@prisma/client";

import { SCHOOL_STATUS_TONES, schoolStatusTone } from "../app/admin/schools/school-status";
import { rankLabel, rankTone } from "../app/admin/schools/[id]/manage/ranking-badge";
import {
  ACCREDITATION_TYPE_LABELS,
  ACCREDITATION_TYPE_TONES,
  accreditationTypeLabel,
  accreditationTypeTone,
} from "../app/admin/schools/[id]/manage/accreditation-type";

const DIR = "app/admin/schools/[id]";
const read = (file: string) => readFileSync(file, "utf8").replace(/\r/g, "");
/** Le code seul, sans les commentaires (un commentaire peut nommer ce que le code n'a plus). */
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

type LastEditComponent = ComponentType<{ text: string | null | undefined }>;
let LastEdit: LastEditComponent;

before(async () => {
  ({ default: LastEdit } = (await import("../app/admin/schools/[id]/LastEdit")) as unknown as { default: LastEditComponent });
});

test("LastEdit pose le texte, et rien pour une donnée d'avant le suivi", () => {
  // L'attendu change avec la règle (étape 9, lot 3) : la copie à l'ancien
  // style de l'intervalle (D61) est retirée ; seule reste la version de la
  // charte, que prennent tous les écrans.
  const html = renderToStaticMarkup(createElement(LastEdit, { text: "Modifié par Camille Martin le 19 octobre 2026" }));
  assert.match(html, /Modifié par Camille Martin le 19 octobre 2026/);
  assert.equal(renderToStaticMarkup(createElement(LastEdit, { text: null })), "");
  assert.equal(renderToStaticMarkup(createElement(LastEdit, { text: undefined })), "");
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

for (const [file, count] of Object.entries(SCREENS)) {
  test(`${file} : « Modifié par … le … » sur chaque donnée`, () => {
    const source = read(`${DIR}/${file}`);
    // L'attendu change avec la règle (étape 9, lot 3) : l'exception de
    // l'intervalle (D61, la copie de manage/legacy/ pour les quatre onglets du
    // lot 3) est retirée ; tous les écrans reviennent à « [./]+/LastEdit ».
    assert.match(source, /import LastEdit from "[./]+\/LastEdit";/, `${file} : LastEdit importé`);
    const shown = source.match(/<LastEdit\s+text=\{[\w.?]+\.last_edit\}\s*\/>/g) ?? [];
    assert.equal(shown.length, count, `${file} : ${shown.length} donnée(s) avec leur auteur`);
    assert.match(source, /last_edit\??: string \| null;/, `${file} : last_edit dans le type des données`);
  });
}

// L'attendu change avec la règle (étape 9, lot 3) : les tests D61 (seuls les
// onglets du lot 3 prennent les copies de manage/legacy/) et D60 (leur îlot
// après le gabarit) gardaient l'intervalle entre les lots 2 et 3 ; ils
// deviennent celui-ci : plus d'îlot ni de copie, les huit onglets dans le
// gabarit et dans la charte.
test("Lot 3 : plus d'îlot ni de copie à l'ancien style, les huit onglets dans le gabarit (D60, D61 retirées)", () => {
  assert.equal(existsSync(`${DIR}/manage/legacy`), false, "manage/legacy/ supprimé");
  for (const file of Object.keys(SCREENS)) {
    assert.doesNotMatch(read(`${DIR}/${file}`), /from "\.\.\/legacy\//, file);
  }
  for (const piece of ["ProgramSelector", "YearSelector"]) {
    assert.doesNotMatch(read(`${DIR}/manage/components/${piece}.tsx`), /className="(btn|form-control|year-selector)/, `${piece} : dans la charte`);
  }
  const page = read(`${DIR}/manage/page.tsx`);
  assert.doesNotMatch(page, /TabFrame|legacy/, "ni îlot ni drapeau");
  const tabs = [...page.matchAll(/\{ key: "([\w-]+)", label: "[^"]+" \}/g)].map((m) => m[1]);
  assert.equal(tabs.length, 8, "huit onglets, sans drapeau");
  // Tous les panneaux se posent dans le gabarit, aucun après.
  const end = page.indexOf("</AdminPage>");
  assert.ok(end > 0);
  assert.ok(page.indexOf("{TABS.map(panel)}") > 0 && page.indexOf("{TABS.map(panel)}") < end, "dans le gabarit");
  assert.equal(page.slice(end).includes("panel"), false, "rien après </AdminPage>");
  // Les quatre onglets du lot 3 : les composants de la charte, plus de fenêtre
  // `modal-overlay` ni d'ancienne classe de formulaire.
  for (const tab of ["CampusProgramsTab", "PricingTab", "RankingsTab", "CapacitiesTab"]) {
    const source = read(`${DIR}/manage/tabs/${tab}.tsx`);
    assert.match(source, /from "@\/components\/ui\/Dialog"/, tab);
    assert.doesNotMatch(source, /modal-overlay|form-control|className="btn/, tab);
  }
  // Les sélecteurs d'année et de programme : ceux de la charte, à leur chemin.
  for (const tab of ["PricingTab", "RankingsTab", "CapacitiesTab"]) {
    assert.match(read(`${DIR}/manage/tabs/${tab}.tsx`), /import YearSelector from "\.\.\/components\/YearSelector";/, tab);
  }
  for (const tab of ["PricingTab", "RankingsTab"]) {
    assert.match(read(`${DIR}/manage/tabs/${tab}.tsx`), /import ProgramSelector from "\.\.\/components\/ProgramSelector";/, tab);
  }
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
  // L'attendu suit la forme de l'entrée (étape 9, lot 3) : un troisième champ
  // (l'icône à l'étape 8, le drapeau `legacy` au lot 2) suivait le libellé ;
  // le drapeau parti avec l'îlot, l'entrée se ferme après lui.
  assert.match(page, /\{ key: "admissions", label: "Admissions" \}/);
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

test("Étape 10 : le type d'une accréditation en français sur sa carte ; la base et le formulaire gardent les valeurs", () => {
  assert.deepEqual(ACCREDITATION_TYPE_LABELS, { international: "International", state: "État", label: "Label" });
  // Les tons de catégorie du lot 2 (charte §6) ne changent pas.
  assert.deepEqual(ACCREDITATION_TYPE_TONES, { international: "accent", state: "solid", label: "neutral" });
  assert.equal(accreditationTypeLabel("state"), "État");
  assert.equal(accreditationTypeTone("state"), "solid");
  // La colonne n'a pas de contrainte : une valeur inconnue s'affiche telle
  // quelle, en neutre, plutôt que de disparaître.
  assert.equal(accreditationTypeLabel("autre"), "autre");
  assert.equal(accreditationTypeTone("autre"), "neutral");
  const source = code(`${DIR}/manage/tabs/AccreditationsTab.tsx`);
  assert.match(
    source,
    /<Badge tone=\{accreditationTypeTone\(acc\.accreditation_type\)\}>\{accreditationTypeLabel\(acc\.accreditation_type\)\}<\/Badge>/,
  );
  assert.doesNotMatch(source, />\{acc\.accreditation_type\}</, "plus de valeur brute à l'écran");
  // Le formulaire envoie toujours la valeur de la base, sous un libellé français.
  for (const [value, text] of [["international", "International"], ["state", "État"], ["label", "Label"]]) {
    assert.match(source, new RegExp(`<option value="${value}">${text} \\(ex: `), value);
  }
});

test("D66 : le badge de statut d'une école suit le statut, sur la liste comme dans la gestion", () => {
  assert.deepEqual(SCHOOL_STATUS_TONES, { ACTIVE: "success", INACTIVE: "neutral", DRAFT: "warning" });
  assert.equal(schoolStatusTone("ARCHIVED"), "neutral", "un statut inconnu reste neutre");
  for (const file of ["app/admin/schools/page.tsx", `${DIR}/manage/page.tsx`]) {
    assert.match(read(file), /<Badge tone=\{schoolStatusTone\(school\.status\)\}>\{school\.status\}<\/Badge>/, file);
  }
});

test("D63, lot 3 : supprimer un tarif se confirme dans le dialogue de la charte, plus par confirm()", () => {
  const source = code(`${DIR}/manage/tabs/PricingTab.tsx`);
  assert.doesNotMatch(source, /\bconfirm\(/);
  assert.match(source, /from "@\/components\/ui\/Dialog"/);
  assert.match(source, /title="Supprimer ce tarif \?"/, "le texte de l'ancienne fenêtre");
  assert.match(source, /onClick=\{\(\) => setConfirmDelete\(true\)\}/);
  // D70 : une vue à la fois, comme avant : le tableau, ou la grille d'un programme.
  assert.match(source, /selectedProgramId === null \? \(/);
  assert.match(source, /← Voir tous les programmes/);
});

test("D68 : le rang d'un classement, sans médaille, en ton de catégorie par palier", () => {
  assert.deepEqual([1, 2, 3, 4, 10, 11, 250].map(rankTone), ["solid", "solid", "solid", "accent", "accent", "neutral", "neutral"]);
  assert.deepEqual([1, 2, 3, 4, 42].map(rankLabel), ["1er", "2ème", "3ème", "#4", "#42"]);
  const source = read(`${DIR}/manage/tabs/RankingsTab.tsx`);
  assert.match(source, /<Badge tone=\{rankTone\(r\.rank\)\}>\{rankLabel\(r\.rank\)\}<\/Badge>/);
});

test("D69 : l'alternance et l'expatriation d'un programme sont des cases à cocher natives, libellées", () => {
  const source = read(`${DIR}/manage/tabs/CampusProgramsTab.tsx`);
  assert.doesNotMatch(source, /toggle-switch|toggle-container|campus-checkbox/);
  for (const [legend, id, state, label] of [
    ["Possibilité d&apos;alternance", "prog-alternance", "progAlternance", "Alternance possible"],
    ["Expatriation obligatoire", "prog-expatriation", "progExpatriation", "Obligatoire"],
  ]) {
    assert.match(source, new RegExp(`<legend[^>]*>${legend}</legend>`), legend);
    assert.match(source, new RegExp(`<input\\s+id="${id}"\\s+type="checkbox"`), id);
    assert.match(source, new RegExp(`checked=\\{${state}\\}`), state);
    assert.match(source, new RegExp(`<label htmlFor="${id}"[^>]*>\\s*${label}\\s*</label>`), label);
  }
  // Les textes de l'état « non » disparaissent : la case vide le dit.
  assert.doesNotMatch(source, /Pas d'alternance|Optionnel \/ Non/);
  assert.match(source, /<legend[^>]*>Campus dispensant ce programme \*<\/legend>/);
});

test("D71 : la modification rapide des places se fait au clavier, et son erreur s'affiche sous le champ", () => {
  const source = code(`${DIR}/manage/tabs/CapacitiesTab.tsx`);
  assert.doesNotMatch(source, /\balert\(/, "plus de fenêtre du navigateur");
  assert.doesNotMatch(source, /<span\s+onClick/, "plus de texte cliquable");
  assert.match(source, /<button\s+type="button"[\s\S]*?title="Cliquer pour modifier rapidement"[\s\S]*?\{c\.spots_available\} places\s*<\/button>/);
  assert.match(source, /aria-label="Places disponibles"/);
  assert.match(source, /aria-label="Enregistrer"/);
  assert.match(source, /aria-label="Annuler"/);
  assert.match(source, /role="alert"[^>]*>\s*\{inlineError\}/);
  assert.match(source, /setInlineError\("Le nombre de places doit être un nombre ≥ 0"\)/, "le texte de l'ancienne fenêtre");
  assert.match(source, /if \(e\.key === "Enter"\) handleInlineSave\(c\.id\);/);
  assert.match(source, /if \(e\.key === "Escape"\) cancelInlineEdit\(c\.id\);/);
});

test("D73 : sur une carte, un titre long garde la largeur, et ses boutons passent dessous", () => {
  // Contrôle du 21 octobre : « Modifier » et « Supprimer » ne laissaient que
  // 80 px au titre, coupé au milieu d'un mot (« Managemen-t »).
  for (const [tab, prefix] of [
    ["AccreditationsTab", "acc"],
    ["AdmissionsTab", "entry"],
    ["CampusProgramsTab", "campus"],
  ]) {
    const source = read(`${DIR}/manage/tabs/${tab}.tsx`);
    assert.match(
      source,
      new RegExp(`<div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">\\s*<h3 id=\\{\`${prefix}-\\$\\{`),
      tab,
    );
  }
});

test("D72 : le lien « Source » des classements et des capacités n'est cliquable qu'en http(s)", () => {
  for (const tab of ["RankingsTab", "CapacitiesTab"]) {
    const source = read(`${DIR}/manage/tabs/${tab}.tsx`);
    assert.match(source, /from "@\/lib\/provenance"/, tab);
    assert.match(source, /href=\{sourceHref\([\w.]+\.source_url\)!\}/, tab);
    assert.doesNotMatch(source, /href=\{[\w.]+\.source_url\}/, `${tab} : plus de lien brut`);
    assert.match(source, /rel="noopener noreferrer"/, tab);
  }
});
