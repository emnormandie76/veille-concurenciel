/**
 * test/content-reports.test.ts — Les règles du signalement (lib/content-reports.ts)
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 6 : ce qu'un signalement doit porter pour être
 * reçu (D13, D34, D35), ce qu'un gestionnaire en décide, et ce que chacun en
 * voit : le gestionnaire, le nom affiché de l'auteur (D39) ; l'auteur, l'état
 * et la réponse (D36). Une cible supprimée garde son nom (D37).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CATEGORY_LABELS,
  CATEGORY_TABS,
  MESSAGE_MAX_LENGTH,
  MESSAGE_MIN_LENGTH,
  REPORT_CATEGORIES,
  REPORT_RATE_LIMIT,
  REPORT_RATE_WINDOW_MS,
  REPORT_STATUSES,
  RESPONSE_MAX_LENGTH,
  STATUS_LABELS,
  describeTarget,
  forReportAuthor,
  forReportManager,
  manageHref,
  readDecision,
  readReport,
  reportRateKey,
  textLength,
} from "../lib/content-reports";
import { SOURCE_URL_ERROR } from "../lib/provenance";

const MESSAGE = "Les frais de 2026 ont changé : 17 500 € la première année.";
const valid = (overrides: Record<string, unknown> = {}) => ({
  schoolId: "school-1",
  category: "PRICING",
  message: MESSAGE,
  ...overrides,
});

// ─── Le formulaire ──────────────────────────────────────────────────────────

test("readReport : un signalement complet est rendu propre (espaces retirés, cible vide → null)", () => {
  const read = readReport(valid({ message: `  ${MESSAGE}  `, programId: " program-1 ", campusId: "", source_url: " https://www.em-normandie.com/fr/tarifs " }));
  assert.deepEqual(read, {
    ok: true,
    value: {
      schoolId: "school-1",
      campusId: null,
      programId: "program-1",
      category: "PRICING",
      message: MESSAGE,
      source_url: "https://www.em-normandie.com/fr/tarifs",
    },
  });
});

test("readReport : l'école est obligatoire ; un campus et un programme à la fois sont refusés", () => {
  for (const schoolId of [undefined, null, "", "   ", 42]) assert.equal(readReport(valid({ schoolId })).ok, false, String(schoolId));
  assert.equal(readReport(valid({ campusId: "campus-1", programId: "program-1" })).ok, false);
  assert.equal(readReport(valid({ campusId: 7 })).ok, false);
  assert.equal(readReport(valid({ campusId: "campus-1" })).ok, true);
});

test("readReport : la catégorie vient de la liste fermée", () => {
  for (const category of REPORT_CATEGORIES) assert.equal(readReport(valid({ category })).ok, true, category);
  for (const category of [undefined, "", "pricing", "Tarifs", "Pending_AI", 3]) assert.equal(readReport(valid({ category })).ok, false, String(category));
});

test("readReport : le message fait de 10 à 2 000 caractères, comptés comme Postgres", () => {
  assert.equal(MESSAGE_MIN_LENGTH, 10);
  assert.equal(MESSAGE_MAX_LENGTH, 2000);
  assert.equal(readReport(valid({ message: "x".repeat(9) })).ok, false);
  assert.equal(readReport(valid({ message: "x".repeat(10) })).ok, true);
  assert.equal(readReport(valid({ message: "x".repeat(2000) })).ok, true);
  assert.equal(readReport(valid({ message: "x".repeat(2001) })).ok, false);
  assert.equal(readReport(valid({ message: `   ${"x".repeat(9)}   ` })).ok, false, "les espaces autour ne comptent pas");
  for (const message of [undefined, null, 12345678901, ["x".repeat(20)]]) assert.equal(readReport(valid({ message })).ok, false, String(message));
  // Cinq émojis font dix unités UTF-16, mais cinq caractères pour char_length.
  assert.equal(textLength("😀".repeat(5)), 5);
  assert.equal(readReport(valid({ message: "😀".repeat(5) })).ok, false);
  assert.equal(readReport(valid({ message: "😀".repeat(2000) })).ok, true);
});

test("D34 : le lien facultatif suit la règle D27", () => {
  for (const source_url of [undefined, null, "", "  "]) {
    const read = readReport(valid({ source_url }));
    assert.ok(read.ok && read.value.source_url === null, String(source_url));
  }
  for (const source_url of ["javascript:alert(1)", "www.em-normandie.com", "ftp://x.fr/a", 12, `https://x.fr/${"a".repeat(2048)}`]) {
    assert.deepEqual(readReport(valid({ source_url })), { ok: false, error: SOURCE_URL_ERROR }, String(source_url).slice(0, 40));
  }
  assert.equal(readReport(valid({ source_url: "http://www.letudiant.fr/classement" })).ok, true, "http accepté, comme D27");
});

test("readReport : aucun champ du corps ne choisit l'auteur ni l'état", () => {
  const read = readReport(valid({ author_id: "u-autre", status: "RESOLVED", handled_by_id: "u-autre" }));
  assert.ok(read.ok);
  assert.deepEqual(Object.keys(read.value).sort(), ["campusId", "category", "message", "programId", "schoolId", "source_url"]);
});

test("D35 : 10 signalements par heure, comptés par compte", () => {
  assert.equal(REPORT_RATE_LIMIT, 10);
  assert.equal(REPORT_RATE_WINDOW_MS, 60 * 60 * 1000);
  assert.equal(reportRateKey("u-1"), "report:u-1");
});

// ─── La décision du gestionnaire ────────────────────────────────────────────

test("readDecision : traité ou rejeté, avec une réponse facultative de 1 000 caractères au plus", () => {
  assert.deepEqual(readDecision({ status: "RESOLVED" }), { ok: true, value: { status: "RESOLVED", response: null } });
  assert.deepEqual(readDecision({ status: "REJECTED", response: "  Déjà à jour.  " }), {
    ok: true,
    value: { status: "REJECTED", response: "Déjà à jour." },
  });
  assert.deepEqual(readDecision({ status: "RESOLVED", response: "   " }), { ok: true, value: { status: "RESOLVED", response: null } });
  assert.equal(RESPONSE_MAX_LENGTH, 1000);
  assert.equal(readDecision({ status: "RESOLVED", response: "x".repeat(1000) }).ok, true);
  assert.equal(readDecision({ status: "RESOLVED", response: "x".repeat(1001) }).ok, false);
  for (const status of [undefined, "OPEN", "resolved", "Validated"]) assert.equal(readDecision({ status }).ok, false, String(status));
  assert.equal(readDecision({ status: "RESOLVED", response: 3 }).ok, false);
});

// ─── Les listes, et l'onglet de chaque catégorie ────────────────────────────

test("chaque catégorie a un libellé et un onglet de gestion ; chaque état a un libellé", () => {
  // Étape 8 (D52) : « Admissions », reliée au nouvel onglet.
  assert.deepEqual([...REPORT_CATEGORIES], ["SCHOOL_INFO", "CAMPUS_PROGRAM", "ADMISSIONS", "PRICING", "CAPACITY", "RANKING", "STATS", "ACCREDITATION", "OTHER"]);
  assert.equal(CATEGORY_LABELS.ADMISSIONS, "Admissions");
  assert.deepEqual(Object.keys(CATEGORY_LABELS), [...REPORT_CATEGORIES]);
  assert.deepEqual(Object.keys(CATEGORY_TABS), [...REPORT_CATEGORIES]);
  assert.deepEqual([...REPORT_STATUSES], ["OPEN", "RESOLVED", "REJECTED"]);
  assert.deepEqual(STATUS_LABELS, { OPEN: "En attente", RESOLVED: "Traité", REJECTED: "Rejeté" });
});

test("manageHref : l'onglet de la catégorie, « Infos » pour une catégorie inconnue", () => {
  assert.equal(manageHref("school-1", "PRICING"), "/admin/schools/school-1/manage?tab=pricing");
  assert.equal(manageHref("school-1", "CAPACITY"), "/admin/schools/school-1/manage?tab=capacities");
  assert.equal(manageHref("school-1", "ADMISSIONS"), "/admin/schools/school-1/manage?tab=admissions");
  assert.equal(manageHref("school-1", "OTHER"), "/admin/schools/school-1/manage?tab=info");
  assert.equal(manageHref("school-1", "INCONNUE"), "/admin/schools/school-1/manage?tab=info");
  assert.equal(manageHref("a/b?c", "STATS"), "/admin/schools/a%2Fb%3Fc/manage?tab=stats");
});

// ─── Ce que chacun voit ─────────────────────────────────────────────────────

const AT = new Date("2026-10-20T09:15:00Z");
const ROW = {
  id: "report-1",
  schoolId: "school-1",
  campusId: null,
  programId: "program-1",
  target_type: "PROGRAM",
  target_label: "Programme Grande École",
  category: "PRICING",
  message: MESSAGE,
  source_url: "https://www.em-normandie.com/fr/tarifs",
  status: "OPEN",
  response: null,
  created_at: AT,
  handled_at: null,
  school: { name: "Em Normandie" },
  author: { display_name: "Camille Martin" },
  handledBy: null,
};

test("describeTarget : l'école, un campus ou un programme, « supprimé » quand la cible n'existe plus (D37)", () => {
  assert.equal(describeTarget(ROW), "Programme « Programme Grande École »");
  assert.equal(describeTarget({ ...ROW, programId: null }), "Programme « Programme Grande École » (supprimé)");
  assert.equal(describeTarget({ ...ROW, target_type: "CAMPUS", target_label: "Caen", programId: null, campusId: "campus-1" }), "Campus « Caen »");
  assert.equal(describeTarget({ ...ROW, target_type: "CAMPUS", target_label: "Caen", programId: null, campusId: null }), "Campus « Caen » (supprimé)");
  assert.equal(describeTarget({ ...ROW, target_type: "SCHOOL", target_label: "Em Normandie", programId: null }), "L'école");
});

test("forReportManager (D39) : le nom affiché de l'auteur, le lien vérifié, l'onglet ; ni identifiant de compte ni adresse", () => {
  const view = forReportManager(ROW);
  assert.deepEqual(view, {
    id: "report-1",
    school: { id: "school-1", name: "Em Normandie" },
    target: "Programme « Programme Grande École »",
    category_label: "Tarifs",
    message: MESSAGE,
    source_href: "https://www.em-normandie.com/fr/tarifs",
    status: "OPEN",
    status_label: "En attente",
    response: null,
    author: "Camille Martin",
    handled_by: null,
    created_label: "20 octobre 2026",
    handled_label: null,
    manage_href: "/admin/schools/school-1/manage?tab=pricing",
  });
  const handled = forReportManager({
    ...ROW,
    status: "REJECTED",
    response: "Déjà à jour.",
    handled_at: new Date("2026-11-01T10:00:00Z"),
    author: { display_name: null },
    handledBy: { display_name: "Goat" },
    source_url: "javascript:alert(1)",
  });
  assert.equal(handled.author, "Compte sans nom");
  assert.equal(handled.handled_by, "Goat");
  assert.equal(handled.handled_label, "1er novembre 2026");
  assert.equal(handled.source_href, null, "seul un lien http(s) devient cliquable");
});

test("forReportAuthor (D36) : la date, la cible, la catégorie, l'état et la réponse, sans le nom du gestionnaire", () => {
  const view = forReportAuthor({ ...ROW, status: "RESOLVED", response: "Corrigé, merci.", handled_at: AT });
  assert.deepEqual(view, {
    id: "report-1",
    school_name: "Em Normandie",
    target: "Programme « Programme Grande École »",
    category_label: "Tarifs",
    status: "RESOLVED",
    status_label: "Traité",
    response: "Corrigé, merci.",
    created_label: "20 octobre 2026",
    handled_label: "20 octobre 2026",
  });
});
