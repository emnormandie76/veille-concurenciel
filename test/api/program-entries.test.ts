/**
 * test/api/program-entries.test.ts — L'onglet « Admissions » : lire, créer, modifier, supprimer une entrée
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 8, au motif des classements (D50) :
 * - `GET schools/[id]/entries` : les entrées des programmes de l'école (filtre
 *   `programId`), chacune avec « Modifié par … le … » (D29), le nom seul ;
 * - `POST programs/[id]/entries` : une entrée de plus pour un programme ;
 * - `PUT` et `DELETE program-entries/[id]` : une entrée, par son id.
 *
 * Ce que le test exige (D16, D26, D27, D48, D49) :
 * - l'auteur vient de la session, jamais du corps (ni l'auteur, ni le
 *   programme, ni l'origine) ; l'origine est `MANUAL` ;
 * - un envoi illisible (année, niveau, voie, note, lien) → 400, rien de lu ni
 *   d'écrit ; une entrée en double (même année, même niveau, même voie dans le
 *   programme) → 400, rien d'écrit ;
 * - après une écriture réussie, et seulement alors, les fiches sont
 *   revalidées ;
 * - rien dans l'inbox (piège 6) ; chaque requête relue contre le schéma.
 */

import { afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { installFakePrisma, type FakeModels } from "../helpers/fake-prisma";
import { installContentCache } from "../helpers/provenance";
import { schemaErrors } from "../helpers/prisma-schema";
import { installSession } from "../helpers/session";
import { body, get, params, quietly } from "../helpers/requests";
import { DUPLICATE_ENTRY_ERROR } from "../../lib/program-entries";
import { SOURCE_URL_ERROR } from "../../lib/provenance";

const db = installFakePrisma();
const session = installSession();
const revalidations = installContentCache();

type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let LIST: Handler;
let CREATE: Handler;
let UPDATE: Handler;
let REMOVE: Handler;

before(async () => {
  ({ GET: LIST } = (await import("../../app/api/admin/schools/[id]/entries/route")) as unknown as { GET: Handler });
  ({ POST: CREATE } = (await import("../../app/api/admin/programs/[id]/entries/route")) as unknown as { POST: Handler });
  ({ PUT: UPDATE, DELETE: REMOVE } = (await import("../../app/api/admin/program-entries/[id]/route")) as unknown as {
    PUT: Handler;
    DELETE: Handler;
  });
});

beforeEach(() => {
  session.as("GESTIONNAIRE");
  revalidations.length = 0;
});

afterEach(() => {
  assert.deepEqual(schemaErrors(db.calls), []);
  assert.equal(db.calls.some((c) => c.model === "contributionInbox"), false, "piège 6 : rien dans l'inbox");
});

const SCHOOL = { id: "school-1", name: "Em Normandie", official_domain: "em-normandie.com", status: "ACTIVE" };
const PROGRAM = { id: "program-1", schoolId: SCHOOL.id, name: "Programme Grande École" };
const AT = new Date("2026-10-20T09:15:00Z");
const ENTRY = {
  id: "entry-1",
  programId: PROGRAM.id,
  entry_year: 1,
  required_level: 2,
  route: "EXAM",
  note: "Concours BCE",
  source_url: "https://www.em-normandie.com/fr/pge/admissions",
  updated_at: AT,
  updated_by_id: "u-camille",
  updated_via: "MANUAL",
  updatedBy: { display_name: "Camille Martin" },
  program: { id: PROGRAM.id, name: PROGRAM.name },
};

/** Ce qu'un corps de requête tente d'imposer : jamais écrit. */
const INTRUDER = {
  programId: "programme-intrus",
  updated_by_id: "compte-intrus",
  updated_via: "AI",
  updated_at: "2000-01-01T00:00:00.000Z",
};

const SENT = { entry_year: 3, required_level: 2, route: "EXAM", note: " Concours Passerelle 1 ", source_url: " https://www.passerelle-esc.com " };
const WRITTEN = { entry_year: 3, required_level: 2, route: "EXAM", note: "Concours Passerelle 1", source_url: "https://www.passerelle-esc.com" };

/** Une écriture rend ce qu'on lui donne, avec un id et l'auteur relu. */
const echo = (id: string) => (args: { data: object }) => ({ id, ...args.data, updatedBy: { display_name: "Gestionnaire" } });

const writtenData = (method: string): Record<string, unknown> => {
  const call = db.writes().find((c) => c.model === "programEntry" && c.method === method);
  assert.ok(call, `programEntry.${method} attendu`);
  return (call.args[0] as { data: Record<string, unknown> }).data;
};

function assertProvenance(data: Record<string, unknown>) {
  assert.equal(data.updated_by_id, "test-gestionnaire", "l'auteur est le compte de la session");
  assert.equal(data.updated_via, "MANUAL");
  assert.ok(data.updated_at instanceof Date, "la date est posée par le serveur");
  assert.ok(Date.now() - (data.updated_at as Date).getTime() < 60_000);
}

function assertRevalidated() {
  // Étape 15 (D123) : les fiches ne sont plus en cache, seules les routes de l'API le sont.
  assert.deepEqual(revalidations, [["/api/schools", "layout"]]);
}

/** Aucune trace de l'auteur au-delà de son nom. */
function assertNoAuthorLeak(json: unknown) {
  const text = JSON.stringify(json);
  assert.doesNotMatch(text, /"updated_by_id"|"updated_via"|"updatedBy"|u-camille|test-gestionnaire/);
}

// ─── Lire ───────────────────────────────────────────────────────────────────

test("GET : les entrées des programmes de l'école, « Modifié par » le nom seul, ni identifiant ni origine", async () => {
  db.use({ school: { findUnique: () => SCHOOL }, programEntry: { findMany: () => [ENTRY] } });
  const res = await LIST(get(`http://localhost/api/admin/schools/${SCHOOL.id}/entries`), params({ id: SCHOOL.id }));
  assert.equal(res.status, 200);
  const json = (await res.json()) as Array<Record<string, unknown>>;
  assert.equal(json.length, 1);
  assert.equal(json[0].last_edit, "Modifié par Camille Martin le 20 octobre 2026");
  assert.deepEqual(json[0].program, { id: PROGRAM.id, name: PROGRAM.name });
  assert.equal(json[0].route, "EXAM");
  assertNoAuthorLeak(json);

  const args = db.calls.find((c) => c.model === "programEntry")!.args[0] as Record<string, unknown>;
  assert.deepEqual(args.where, { program: { schoolId: SCHOOL.id } });
  assert.match(JSON.stringify(args), /"updatedBy":\{"select":\{"display_name":true\}\}/);
});

test("GET ?programId= : les entrées d'un seul programme", async () => {
  db.use({ school: { findUnique: () => SCHOOL }, programEntry: { findMany: () => [] } });
  const res = await LIST(get(`http://localhost/x?programId=${PROGRAM.id}`), params({ id: SCHOOL.id }));
  assert.equal(res.status, 200);
  const args = db.calls.find((c) => c.model === "programEntry")!.args[0] as Record<string, unknown>;
  assert.deepEqual(args.where, { program: { schoolId: SCHOOL.id }, programId: PROGRAM.id });
});

test("GET : une école absente → 404", async () => {
  db.use({ school: { findUnique: () => null } });
  const res = await LIST(get(), params({ id: "absente" }));
  assert.equal(res.status, 404);
});

test("GET en USER : 403, rien de lu", async () => {
  session.as("USER");
  db.use({});
  const res = await LIST(get(), params({ id: SCHOOL.id }));
  assert.equal(res.status, 403);
  assert.deepEqual(db.calls, []);
});

// ─── Créer ──────────────────────────────────────────────────────────────────

function creating(models: FakeModels = {}) {
  db.use({
    program: { findUnique: () => PROGRAM },
    programEntry: { findUnique: () => null, create: echo("entry-new") },
    ...models,
  });
}

test("POST : l'entrée du corps, le programme de l'URL, l'auteur de la session (D49)", async () => {
  creating();
  const res = await CREATE(body({ ...SENT, ...INTRUDER }), params({ id: PROGRAM.id }));
  assert.equal(res.status, 201);
  const data = writtenData("create");
  const { updated_at, updated_by_id, updated_via, ...content } = data;
  assertProvenance({ updated_at, updated_by_id, updated_via });
  assert.deepEqual(content, { programId: PROGRAM.id, ...WRITTEN });
  assertRevalidated();

  const json = await res.json();
  assert.equal(json.last_edit.startsWith("Modifié par Gestionnaire le "), true);
  assertNoAuthorLeak(json);
});

test("POST : la clé composée cherche le doublon dans ce programme", async () => {
  creating();
  await CREATE(body(SENT), params({ id: PROGRAM.id }));
  const lookup = db.calls.find((c) => c.model === "programEntry" && c.method === "findUnique")!.args[0] as Record<string, unknown>;
  assert.deepEqual(lookup.where, {
    programId_entry_year_required_level_route: { programId: PROGRAM.id, entry_year: 3, required_level: 2, route: "EXAM" },
  });
});

test("POST : un envoi illisible → 400, rien de lu ni d'écrit", async () => {
  const cases: Array<[Record<string, unknown> | string, RegExp]> = [
    [{ ...SENT, entry_year: 6 }, /année d'entrée/],
    [{ ...SENT, required_level: "Bac+2" }, /niveau requis/],
    [{ ...SENT, route: "AST" }, /voie/],
    [{ ...SENT, note: "x".repeat(501) }, /note/],
    [{ ...SENT, source_url: "javascript:alert(1)" }, /adresse web/],
    ["{ pas du json", /objet JSON|Rien n'a été écrit/],
    [[1, 2] as unknown as Record<string, unknown>, /objet JSON|Rien n'a été écrit/],
  ];
  for (const [payload, message] of cases) {
    creating();
    const res = await CREATE(body(payload), params({ id: PROGRAM.id }));
    assert.equal(res.status, 400, JSON.stringify(payload).slice(0, 40));
    assert.match((await res.json()).error, message);
    assert.deepEqual(db.calls, [], "rien de lu");
    assert.deepEqual(revalidations, []);
  }
});

test("POST : le lien source refusé dit pourquoi (D27)", async () => {
  creating();
  const res = await CREATE(body({ ...SENT, source_url: "www.ecole.fr" }), params({ id: PROGRAM.id }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, SOURCE_URL_ERROR);
});

test("POST : un programme absent → 404, rien d'écrit", async () => {
  creating({ program: { findUnique: () => null } });
  const res = await CREATE(body(SENT), params({ id: "absent" }));
  assert.equal(res.status, 404);
  assert.deepEqual(db.writes(), []);
  assert.deepEqual(revalidations, []);
});

test("POST : la même entrée existe déjà → 400, rien d'écrit", async () => {
  creating({ programEntry: { findUnique: () => ENTRY, create: echo("entry-new") } });
  const res = await CREATE(body(SENT), params({ id: PROGRAM.id }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, DUPLICATE_ENTRY_ERROR);
  assert.deepEqual(db.writes(), []);
  assert.deepEqual(revalidations, []);
});

test("POST : un doublon arrivé entre la lecture et l'écriture (P2002) → 400", async () => {
  creating({
    programEntry: {
      findUnique: () => null,
      create: () => {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      },
    },
  });
  const res = await quietly(() => CREATE(body(SENT), params({ id: PROGRAM.id })));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, DUPLICATE_ENTRY_ERROR);
  assert.deepEqual(revalidations, []);
});

test("POST en USER : 403, rien de lu", async () => {
  session.as("USER");
  creating();
  const res = await CREATE(body(SENT), params({ id: PROGRAM.id }));
  assert.equal(res.status, 403);
  assert.deepEqual(db.calls, []);
});

// ─── Modifier ───────────────────────────────────────────────────────────────

function updating(models: FakeModels = {}) {
  db.use({
    programEntry: {
      findUnique: () => ENTRY,
      findFirst: () => null,
      update: echo(ENTRY.id),
    },
    ...models,
  });
}

test("PUT : l'entrée réécrite entière, l'auteur de la session ; le programme ne change pas", async () => {
  updating();
  const res = await UPDATE(body({ ...SENT, ...INTRUDER }, "PUT"), params({ id: ENTRY.id }));
  assert.equal(res.status, 200);
  const data = writtenData("update");
  const { updated_at, updated_by_id, updated_via, ...content } = data;
  assertProvenance({ updated_at, updated_by_id, updated_via });
  assert.deepEqual(content, WRITTEN);
  assertRevalidated();
  assertNoAuthorLeak(await res.json());
});

test("PUT : le doublon se cherche parmi les autres entrées du même programme", async () => {
  updating();
  await UPDATE(body(SENT, "PUT"), params({ id: ENTRY.id }));
  const lookup = db.calls.find((c) => c.model === "programEntry" && c.method === "findFirst")!.args[0] as Record<string, unknown>;
  assert.deepEqual(lookup.where, {
    programId: PROGRAM.id,
    entry_year: 3,
    required_level: 2,
    route: "EXAM",
    NOT: { id: ENTRY.id },
  });
});

test("PUT : une autre entrée identique → 400, rien d'écrit", async () => {
  updating({ programEntry: { findUnique: () => ENTRY, findFirst: () => ({ id: "entry-2" }), update: echo(ENTRY.id) } });
  const res = await UPDATE(body(SENT, "PUT"), params({ id: ENTRY.id }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, DUPLICATE_ENTRY_ERROR);
  assert.deepEqual(db.writes(), []);
});

test("PUT : une entrée absente → 404 ; un envoi illisible → 400, rien de lu", async () => {
  updating({ programEntry: { findUnique: () => null } });
  assert.equal((await UPDATE(body(SENT, "PUT"), params({ id: "absente" }))).status, 404);
  assert.deepEqual(db.writes(), []);

  updating();
  const res = await UPDATE(body({ ...SENT, entry_year: 0 }, "PUT"), params({ id: ENTRY.id }));
  assert.equal(res.status, 400);
  assert.deepEqual(db.calls, []);
  assert.deepEqual(revalidations, []);
});

// ─── Supprimer ──────────────────────────────────────────────────────────────

test("DELETE : l'entrée supprimée, les fiches revalidées", async () => {
  db.use({ programEntry: { findUnique: () => ENTRY, delete: () => ENTRY } });
  const res = await REMOVE(get("http://localhost/x", "DELETE"), params({ id: ENTRY.id }));
  assert.equal(res.status, 200);
  const removed = db.writes().find((c) => c.model === "programEntry" && c.method === "delete")!;
  assert.deepEqual((removed.args[0] as { where: unknown }).where, { id: ENTRY.id });
  assertRevalidated();
});

test("DELETE : une entrée absente → 404, rien de supprimé", async () => {
  db.use({ programEntry: { findUnique: () => null } });
  const res = await REMOVE(get("http://localhost/x", "DELETE"), params({ id: "absente" }));
  assert.equal(res.status, 404);
  assert.deepEqual(db.writes(), []);
  assert.deepEqual(revalidations, []);
});

test("PUT et DELETE en USER : 403, rien de lu", async () => {
  session.as("USER");
  db.use({});
  assert.equal((await UPDATE(body(SENT, "PUT"), params({ id: ENTRY.id }))).status, 403);
  assert.equal((await REMOVE(get("http://localhost/x", "DELETE"), params({ id: ENTRY.id }))).status, 403);
  assert.deepEqual(db.calls, []);
});
