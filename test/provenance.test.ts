/**
 * test/provenance.test.ts — lib/provenance.ts : qui, quand, d'où
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 5 : la provenance écrite (D10, D11), le lien
 * source contrôlé à la saisie et protégé à l'affichage (D27), le texte
 * « Modifié par … le … » des fiches et le nom de l'auteur (D25). Décisions du
 * 20 octobre : l'API v1 ne rend que la date (D25 revue) ; le gestionnaire
 * montre le nom et la date de la dernière modification (D29).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  API_PROVENANCE_SELECT,
  AUTHOR_SELECT,
  SOURCE_URL_MAX_LENGTH,
  UNNAMED_AUTHOR,
  UPDATE_ORIGINS,
  authorName,
  describeLastEdit,
  describeProvenance,
  forDisplay,
  forManager,
  formatProvenanceDate,
  provenance,
  readSourceUrl,
  sourceHref,
  stampUpdate,
} from "../lib/provenance";

// ─── Écrire ─────────────────────────────────────────────────────────────────

test("provenance : l'auteur, l'origine et l'heure du serveur", () => {
  const now = new Date("2026-10-19T08:30:00Z");
  assert.deepEqual(provenance("u-1", "MANUAL", now), { updated_by_id: "u-1", updated_at: now, updated_via: "MANUAL" });
  const fresh = provenance("u-1", "AI");
  assert.ok(fresh.updated_at instanceof Date && Date.now() - fresh.updated_at.getTime() < 1000);
  assert.deepEqual([...UPDATE_ORIGINS], ["MANUAL", "AI", "REPORT"]);
});

test("stampUpdate : une mise à jour qui écrit reçoit la provenance, une mise à jour vide reste vide (D11)", () => {
  const stamp = provenance("u-1", "AI", new Date("2026-10-19T08:30:00Z"));
  assert.deepEqual(stampUpdate({ city: "Caen" }, stamp), { city: "Caen", ...stamp });
  assert.deepEqual(stampUpdate({ city: undefined, admission_exam: undefined }, stamp), {});
  assert.deepEqual(stampUpdate({}, stamp), {});
  // null est une valeur : elle efface, donc elle écrit.
  assert.deepEqual(stampUpdate({ city: null }, stamp), { city: null, ...stamp });
});

// ─── Le lien source (D27) ───────────────────────────────────────────────────

test("readSourceUrl : absent, null ou blanc → pas de lien", () => {
  for (const raw of [undefined, null, "", "   "]) assert.deepEqual(readSourceUrl(raw), { ok: true, value: null }, String(raw));
});

test("readSourceUrl : une adresse http ou https passe, sans ses espaces", () => {
  assert.deepEqual(readSourceUrl("  https://www.em-normandie.com/fr/tarifs "), { ok: true, value: "https://www.em-normandie.com/fr/tarifs" });
  assert.deepEqual(readSourceUrl("http://www.ecole.fr/a?b=1#c"), { ok: true, value: "http://www.ecole.fr/a?b=1#c" });
});

test("readSourceUrl : tout le reste est refusé, avec un message", () => {
  const long = `https://ecole.fr/${"a".repeat(SOURCE_URL_MAX_LENGTH)}`;
  for (const raw of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://ecole.fr/tarifs.pdf",
    "www.ecole.fr",
    "ecole.fr/tarifs",
    "https://",
    "https://a b.fr",
    long,
    42,
    { href: "https://ecole.fr" },
  ]) {
    const result = readSourceUrl(raw);
    assert.equal(result.ok, false, String(raw).slice(0, 40));
    if (!result.ok) assert.match(result.error, /adresse web/);
  }
  assert.equal(readSourceUrl(`https://ecole.fr/${"a".repeat(SOURCE_URL_MAX_LENGTH - 17)}`).ok, true, "2 048 caractères tout juste");
});

test("sourceHref : seul un lien http(s) devient cliquable", () => {
  assert.equal(sourceHref("https://ecole.fr/x"), "https://ecole.fr/x");
  assert.equal(sourceHref(" http://ecole.fr/x "), "http://ecole.fr/x");
  for (const raw of [null, undefined, "", "javascript:alert(1)", "JavaScript:alert(1)", "www.ecole.fr", "/admin"]) {
    assert.equal(sourceHref(raw), null, String(raw));
  }
});

// ─── L'auteur affiché (D25) ─────────────────────────────────────────────────

test("authorName : le nom affiché, sinon « Compte sans nom », jamais l'adresse ni l'identifiant", () => {
  assert.equal(authorName({ display_name: "Camille Martin" }), "Camille Martin");
  assert.equal(authorName({ display_name: "  " }), UNNAMED_AUTHOR);
  assert.equal(authorName({ display_name: null }), UNNAMED_AUTHOR);
  assert.equal(authorName(null), null);
  assert.equal(authorName(undefined), null);
  // Une lecture ne demande que le nom affiché.
  assert.deepEqual(AUTHOR_SELECT, { select: { display_name: true } });
});

// ─── Le texte des fiches ────────────────────────────────────────────────────

test("formatProvenanceDate : la date de Paris, en toutes lettres, « 1er » compris", () => {
  assert.equal(formatProvenanceDate(new Date("2026-10-19T08:30:00Z")), "19 octobre 2026");
  // 23 h 30 à Londres, le 31 octobre, c'est déjà le 1er novembre à Paris.
  assert.equal(formatProvenanceDate("2026-10-31T23:30:00Z"), "1er novembre 2026");
});

test("describeProvenance : saisie, recherche IA, signalement ; rien pour une ligne d'avant le suivi", () => {
  const at = new Date("2026-10-19T08:30:00Z");
  const author = { display_name: "Camille Martin" };
  assert.equal(describeProvenance({ updated_at: at, updated_via: "MANUAL", updatedBy: author }), "Modifié par Camille Martin le 19 octobre 2026");
  assert.equal(describeProvenance({ updated_at: at, updated_via: "AI", updatedBy: author }), "Validé par Camille Martin le 19 octobre 2026, depuis une recherche IA");
  assert.equal(describeProvenance({ updated_at: at, updated_via: "REPORT", updatedBy: author }), "Modifié par Camille Martin le 19 octobre 2026, après un signalement");
  assert.equal(describeProvenance({ updated_at: at, updated_via: "MANUAL", updatedBy: { display_name: null } }), `Modifié par ${UNNAMED_AUTHOR} le 19 octobre 2026`);
  assert.equal(describeProvenance({ updated_at: null, updated_via: null, updatedBy: null }), null);
  assert.equal(describeProvenance({ updated_at: at.toISOString(), updated_via: "MANUAL", updatedBy: author }), "Modifié par Camille Martin le 19 octobre 2026");
});

test("forDisplay : le texte et le lien cliquable, sans l'identifiant ni la relation de l'auteur", () => {
  const row = {
    id: "st-1",
    total_students: 8000,
    source_url: "javascript:alert(1)",
    updated_at: new Date("2026-10-19T08:30:00Z"),
    updated_via: "MANUAL",
    updated_by_id: "u-1",
    updatedBy: { display_name: "Camille Martin" },
  };
  const shown = forDisplay(row);
  assert.deepEqual(Object.keys(shown).sort(), ["id", "provenance", "source_href", "source_url", "total_students", "updated_at", "updated_via"]);
  assert.equal(shown.provenance, "Modifié par Camille Martin le 19 octobre 2026");
  assert.equal(shown.source_href, null);
  assert.equal(forDisplay({ ...row, source_url: "https://ecole.fr/chiffres" }).source_href, "https://ecole.fr/chiffres");
});

// ─── L'API v1 (D25, revue le 20 octobre) ────────────────────────────────────

test("API_PROVENANCE_SELECT : l'API ne lit que la date, ni l'auteur ni l'origine", () => {
  assert.deepEqual(API_PROVENANCE_SELECT, { updated_at: true });
});

// ─── Le gestionnaire (D29) ──────────────────────────────────────────────────

test("describeLastEdit : le nom et la date, sans l'origine ; rien pour une ligne d'avant le suivi", () => {
  const at = new Date("2026-10-19T08:30:00Z");
  const author = { display_name: "Camille Martin" };
  for (const via of ["MANUAL", "AI", "REPORT"]) {
    // L'origine est là, comme dans une ligne lue : le texte n'en dit rien.
    const row = { updated_at: at, updatedBy: author, updated_via: via };
    assert.equal(describeLastEdit(row), "Modifié par Camille Martin le 19 octobre 2026", via);
  }
  assert.equal(describeLastEdit({ updated_at: at, updatedBy: { display_name: null } }), `Modifié par ${UNNAMED_AUTHOR} le 19 octobre 2026`);
  assert.equal(describeLastEdit({ updated_at: at.toISOString(), updatedBy: author }), "Modifié par Camille Martin le 19 octobre 2026");
  assert.equal(describeLastEdit({ updated_at: null, updatedBy: null }), null);
});

test("forManager : la dernière modification en toutes lettres, sans identifiant, relation ni origine", () => {
  const row = {
    id: "cp-1",
    name: "Caen",
    updated_at: new Date("2026-10-19T08:30:00Z"),
    updated_via: "AI",
    updated_by_id: "u-1",
    updatedBy: { display_name: "Camille Martin" },
  };
  const sent = forManager(row);
  assert.deepEqual(Object.keys(sent).sort(), ["id", "last_edit", "name", "updated_at"]);
  assert.equal(sent.last_edit, "Modifié par Camille Martin le 19 octobre 2026");
  assert.equal(forManager({ id: "cp-2", updated_at: null, updated_via: null, updated_by_id: null, updatedBy: null }).last_edit, null);
});
