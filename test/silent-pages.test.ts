/**
 * test/silent-pages.test.ts — F6 : deux pages qui échouaient sans le dire
 *
 *     npm run test:ts
 *
 * Plan backend-local, étape 7 (défaut F6) :
 * - l'accueil (`app/page.tsx`) affichait « Aucune école trouvée » quand l'API
 *   échouait (`setSchools([])`), et avalait l'échec des statistiques
 *   (`.catch(() => {})`) ;
 * - l'inbox (`app/admin/inbox/page.tsx`) ignorait l'échec du rechargement d'un
 *   ticket (`catch { /* silently ignore *\/ }`), et une réponse non 2xx aussi.
 *
 * Le projet n'a pas de bibliothèque de test React : la décision d'affichage vit
 * dans deux modules purs (lib/public-schools.ts, lib/ticket-refresh.ts), testés
 * ici sans navigateur. Les pages sont lues comme du texte, pour qu'un `catch`
 * muet n'y revienne pas. Le dépôt est en CRLF sur le poste : on tolère `\r`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SCHOOLS_LOAD_ERROR,
  readSchoolsResponse,
  summarizeSchools,
} from "../lib/public-schools";
import { readRefreshedTicket, TICKET_REFRESH_ERROR } from "../lib/ticket-refresh";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r/g, "");

/** Un `catch` dont le bloc est vide ou ne contient qu'un commentaire. */
const MUTED_CATCH = /catch\s*(\([^)]*\))?\s*\{\s*(\/\*[^]*?\*\/|\/\/[^\n]*)?\s*\}/;
// `.catch(() => null)` n'est pas muet : la valeur est lue ensuite (JSON illisible).
const MUTED_PROMISE_CATCH = /\.catch\(\s*\(\s*\)\s*=>\s*(\{\s*\}|undefined)\s*\)/;

// ── Les pages ────────────────────────────────────────────────────────

test("F6 : l'accueil n'avale plus l'échec du chargement des écoles", () => {
  const page = read("app/page.tsx");

  assert.doesNotMatch(page, MUTED_CATCH);
  assert.doesNotMatch(page, MUTED_PROMISE_CATCH);
  // L'échec passe par le module pur et s'affiche, au lieu d'une liste vide.
  assert.match(page, /readSchoolsResponse/);
  assert.match(page, /loadError/);
});

test("F6 : l'inbox n'ignore plus l'échec du rechargement d'un ticket", () => {
  const page = read("app/admin/inbox/page.tsx");

  assert.doesNotMatch(page, /silently ignore/);
  assert.doesNotMatch(page, MUTED_CATCH);
  assert.doesNotMatch(page, MUTED_PROMISE_CATCH);
  assert.match(page, /readRefreshedTicket/);
});

test("le repérage des catch muets repère bien les formes d'origine", () => {
  assert.match("} catch { /* silently ignore */ }", MUTED_CATCH);
  assert.match("} catch {}", MUTED_CATCH);
  assert.match("} catch (e) { // rien\n}", MUTED_CATCH);
  assert.match(".catch(() => {});", MUTED_PROMISE_CATCH);
  assert.doesNotMatch("} catch { setPurgeCount(null); }", MUTED_CATCH);
});

// ── lib/public-schools.ts ────────────────────────────────────────────

const SCHOOL = {
  id: "s-1",
  name: "EM Normandie",
  official_domain: "em-normandie.com",
  status: "ACTIVE",
  campuses: [
    { id: "c-1", name: "Caen", city: "Caen", programs: [{ id: "p-1" }, { id: "p-2" }] },
    { id: "c-2", name: "Paris", city: "Paris", programs: [{ id: "p-1" }] },
  ],
};

test("readSchoolsResponse : une réponse lisible donne la liste et le total", () => {
  assert.deepEqual(readSchoolsResponse(200, { data: [SCHOOL], pagination: { total: 6 } }), {
    ok: true,
    schools: [SCHOOL],
    total: 6,
  });
  // Une liste vide est une réponse, pas une erreur : « aucune école trouvée ».
  assert.deepEqual(readSchoolsResponse(200, { data: [], pagination: { total: 0 } }), {
    ok: true,
    schools: [],
    total: 0,
  });
});

test("readSchoolsResponse : une erreur de l'API n'est jamais une liste vide", () => {
  for (const [status, body] of [
    [500, { error: "Erreur serveur" }],
    [429, { error: "Trop de requêtes" }],
    [200, null],
    [200, { error: "inattendu" }],
    [200, { data: "pas une liste", pagination: { total: 1 } }],
    [200, { data: [SCHOOL] }],
  ] as const) {
    assert.deepEqual(readSchoolsResponse(status, body), { ok: false, error: SCHOOLS_LOAD_ERROR }, String(status));
  }
  assert.match(SCHOOLS_LOAD_ERROR, /n'ont pas pu être chargées/);
});

test("summarizeSchools : écoles, campus et programmes par campus", () => {
  assert.deepEqual(summarizeSchools([SCHOOL, { ...SCHOOL, id: "s-2", campuses: [] }], 6), {
    schools: 6,
    campuses: 2,
    programs: 3,
  });
  assert.deepEqual(summarizeSchools([], 0), { schools: 0, campuses: 0, programs: 0 });
});

// ── lib/ticket-refresh.ts ────────────────────────────────────────────

test("readRefreshedTicket : le ticket rechargé, ou un message qui dit pourquoi", () => {
  const ticket = { id: "t-1", status: "Pending_Admin" };

  assert.deepEqual(readRefreshedTicket(200, ticket), { ok: true, ticket });
  assert.deepEqual(readRefreshedTicket(404, { error: "Ticket introuvable" }), {
    ok: false,
    error: `${TICKET_REFRESH_ERROR} (Ticket introuvable)`,
  });
  assert.deepEqual(readRefreshedTicket(500, null), {
    ok: false,
    error: `${TICKET_REFRESH_ERROR} (HTTP 500)`,
  });
  assert.deepEqual(readRefreshedTicket(200, { status: "sans id" }), {
    ok: false,
    error: `${TICKET_REFRESH_ERROR} (réponse illisible)`,
  });
  assert.match(TICKET_REFRESH_ERROR, /peuvent être anciennes/);
});
