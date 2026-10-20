/**
 * test/api/admin-schools.test.ts — CRUD admin des écoles et des campus
 *
 *     npm run test:ts
 *
 * Plan backend-local, étape 7 (P2) : par route, 400 sur un corps invalide, 404
 * sur un id inconnu, le cas nominal. Chaque requête reçue est relue contre le
 * vrai schéma Prisma. Plan gestion-contenu, étape 1 (G4, D19) : tout se fait en
 * GESTIONNAIRE, création d'école et suppressions en cascade comprises ; un USER
 * est refusé partout.
 *
 * Routes : /api/admin/schools, /schools/[id], /schools/[id]/campuses,
 * /schools/[id]/manage, /schools-with-programs, /campuses/[id].
 */

import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { contentOf, installContentCache } from "../helpers/provenance";
import { installFakePrisma } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";
import { body, get, params, quietly } from "../helpers/requests";
import { installSession } from "../helpers/session";

const db = installFakePrisma();
// Étape 5 : les écritures revalident les fiches (lib/content-cache.ts).
installContentCache();
const session = installSession();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (request: Request, ctx: { params: Promise<any> }) => Promise<Response>;
const h: Record<string, Handler> = {};

before(async () => {
  const schools = await import("../../app/api/admin/schools/route");
  const school = await import("../../app/api/admin/schools/[id]/route");
  const campuses = await import("../../app/api/admin/schools/[id]/campuses/route");
  const campus = await import("../../app/api/admin/campuses/[id]/route");
  const manage = await import("../../app/api/admin/schools/[id]/manage/route");
  const tree = await import("../../app/api/admin/schools-with-programs/route");
  Object.assign(h, {
    listSchools: schools.GET,
    createSchool: schools.POST,
    getSchool: school.GET,
    updateSchool: school.PUT,
    deleteSchool: school.DELETE,
    listCampuses: campuses.GET,
    createCampus: campuses.POST,
    updateCampus: campus.PUT,
    deleteCampus: campus.DELETE,
    manage: manage.GET,
    schoolsWithPrograms: tree.GET,
  });
});

beforeEach(() => {
  session.as("GESTIONNAIRE");
});

const SCHOOL_ID = "school-normandie";
const SCHOOL = { id: SCHOOL_ID, name: "Em Normandie", official_domain: "em-normandie.com", status: "ACTIVE" };
const CAMPUS = { id: "campus-caen", schoolId: SCHOOL_ID, name: "Caen", city: "Caen" };
const id = (value: string) => params({ id: value });

function assertSchema() {
  assert.deepEqual(schemaErrors(db.calls), []);
}

// ── Gardes ───────────────────────────────────────────────────────────

test("sans session : 401 sur chaque handler, aucune requête", async () => {
  session.as("none");
  for (const [name, handler] of Object.entries(h)) {
    db.use({});
    const res = await handler(body({ name: "x" }), id(SCHOOL_ID));
    assert.equal(res.status, 401, name);
    assert.deepEqual(db.calls, [], name);
  }
});

test("un USER reçoit 403 sur chaque handler, rien de lu", async () => {
  session.as("USER");
  for (const [name, handler] of Object.entries(h)) {
    db.use({});
    const res = await handler(body({ name: "x", official_domain: "x.fr" }), id(SCHOOL_ID));
    assert.equal(res.status, 403, name);
    assert.deepEqual(db.calls, [], name);
  }
});

// ── /api/admin/schools ───────────────────────────────────────────────

test("GET /schools : toutes les écoles, avec le nombre de campus", async () => {
  db.use({ school: { findMany: () => [{ ...SCHOOL, _count: { campuses: 2 } }] } });

  const res = await h.listSchools(get(), id(""));

  assert.equal(res.status, 200);
  assert.equal((await res.json())[0]._count.campuses, 2);
  assertSchema();
});

test("POST /schools : nom et domaine requis → 400, rien d'écrit", async () => {
  for (const payload of [{}, { name: "Em Lyon" }, { official_domain: "em-lyon.com" }]) {
    db.use({ school: { findFirst: () => null, create: () => ({}) } });
    assert.equal((await h.createSchool(body(payload), id(""))).status, 400, JSON.stringify(payload));
    assert.deepEqual(db.writes(), []);
  }
});

test("POST /schools : un nom ou un domaine fait d'espaces → 400, rien d'écrit", async () => {
  for (const payload of [
    { name: "   ", official_domain: "em-lyon.com" },
    { name: "Em Lyon", official_domain: "  " },
  ]) {
    db.use({ school: { findFirst: () => null, create: () => ({}) } });
    assert.equal((await h.createSchool(body(payload), id(""))).status, 400, JSON.stringify(payload));
    assert.deepEqual(db.writes(), [], JSON.stringify(payload));
  }
});

test("POST /schools : nom ou domaine déjà pris → 400", async () => {
  db.use({ school: { findFirst: () => SCHOOL, create: () => ({}) } });

  const res = await h.createSchool(body({ name: "Em Normandie", official_domain: "x.fr" }), id(""));

  assert.equal(res.status, 400);
  assert.deepEqual(db.writes(), []);
});

test("POST /schools : 201, nom nettoyé, domaine en minuscules, statut ACTIVE", async () => {
  db.use({ school: { findFirst: () => null, create: ({ data }: { data: object }) => ({ id: "s-new", ...data }) } });

  const res = await h.createSchool(body({ name: "  Em Lyon ", official_domain: " EM-Lyon.com " }), id(""));

  assert.equal(res.status, 201);
  // Étape 5 : l'écriture porte aussi sa provenance (contentOf la vérifie).
  assert.deepEqual(contentOf((db.writes()[0].args[0] as { data: object }).data, "test-gestionnaire"), {
    name: "Em Lyon",
    official_domain: "em-lyon.com",
    status: "ACTIVE",
  });
  assertSchema();
});

// ── /api/admin/schools/[id] ──────────────────────────────────────────

test("GET /schools/[id] : 404 ; sinon l'école", async () => {
  db.use({ school: { findUnique: () => null } });
  assert.equal((await h.getSchool(get(), id("absent"))).status, 404);

  db.use({ school: { findUnique: () => SCHOOL } });
  const res = await h.getSchool(get(), id(SCHOOL_ID));
  assert.equal(res.status, 200);
  // D29 : chaque ligne lue porte « Modifié par … le … », `null` sans provenance.
  assert.deepEqual(await res.json(), { ...SCHOOL, last_edit: null });
  assertSchema();
});

test("PUT /schools/[id] : aucun champ ou statut inconnu → 400, sans base", async () => {
  for (const payload of [{}, { status: "ARCHIVED" }]) {
    db.use({});
    assert.equal((await h.updateSchool(body(payload, "PUT"), id(SCHOOL_ID))).status, 400);
    assert.deepEqual(db.calls, []);
  }
});

test("PUT /schools/[id] : un nom ou un domaine fait d'espaces → 400, rien d'écrit", async () => {
  for (const payload of [{ name: "   " }, { official_domain: " " }]) {
    db.use({ school: { findUnique: () => SCHOOL, findFirst: () => null, update: () => SCHOOL } });
    assert.equal((await h.updateSchool(body(payload, "PUT"), id(SCHOOL_ID))).status, 400, JSON.stringify(payload));
    assert.deepEqual(db.writes(), [], JSON.stringify(payload));
  }
});

test("PUT /schools/[id] : école inconnue → 404 ; nom pris par une autre → 400", async () => {
  db.use({ school: { findUnique: () => null } });
  assert.equal((await h.updateSchool(body({ status: "INACTIVE" }, "PUT"), id("absent"))).status, 404);

  db.use({ school: { findUnique: () => SCHOOL, findFirst: () => ({ id: "autre" }), update: () => SCHOOL } });
  assert.equal((await h.updateSchool(body({ name: "Em Lyon" }, "PUT"), id(SCHOOL_ID))).status, 400);
  assert.deepEqual(db.writes(), []);
});

test("PUT /schools/[id] : 200, champs nettoyés, unicité cherchée hors de l'école elle-même", async () => {
  db.use({
    school: {
      findUnique: () => SCHOOL,
      findFirst: () => null,
      update: ({ data }: { data: object }) => ({ ...SCHOOL, ...data }),
    },
  });

  const res = await h.updateSchool(
    body({ name: " EM Normandie ", official_domain: "WWW.em-normandie.com", status: "INACTIVE" }, "PUT"),
    id(SCHOOL_ID)
  );

  assert.equal(res.status, 200);
  const findFirst = db.calls.find((c) => c.method === "findFirst")!.args[0] as { where: { id: unknown } };
  assert.deepEqual(findFirst.where.id, { not: SCHOOL_ID });
  assert.deepEqual(contentOf((db.writes()[0].args[0] as { data: object }).data, "test-gestionnaire"), {
    name: "EM Normandie",
    official_domain: "www.em-normandie.com",
    status: "INACTIVE",
  });
  assertSchema();
});

test("DELETE /schools/[id] : 404 ; confirmation absente ou fausse → 400 ; nom exact → supprimée", async () => {
  db.use({ school: { findUnique: () => null, delete: () => ({}) } });
  assert.equal((await h.deleteSchool(get("http://localhost/x?confirmName=x", "DELETE"), id("absent"))).status, 404);

  for (const query of ["", "?confirmName=em%20normandie", "?confirmName=Em"]) {
    db.use({ school: { findUnique: () => SCHOOL, delete: () => ({}) } });
    const res = await h.deleteSchool(get(`http://localhost/x${query}`, "DELETE"), id(SCHOOL_ID));
    assert.equal(res.status, 400, query);
    assert.deepEqual(db.writes(), [], query);
  }

  db.use({ school: { findUnique: () => SCHOOL, delete: () => SCHOOL } });
  const res = await h.deleteSchool(get("http://localhost/x?confirmName=%20Em%20Normandie%20", "DELETE"), id(SCHOOL_ID));
  assert.equal(res.status, 200);
  assert.deepEqual(db.writes()[0].args, [{ where: { id: SCHOOL_ID } }]);
});

// ── /api/admin/schools/[id]/campuses ─────────────────────────────────

test("GET /schools/[id]/campuses : les campus de l'école, par nom", async () => {
  db.use({ school: { findUnique: () => SCHOOL }, campus: { findMany: () => [CAMPUS] } });

  const res = await h.listCampuses(get(), id(SCHOOL_ID));

  assert.equal(res.status, 200);
  // D29 : chaque ligne lue porte « Modifié par … le … », `null` sans provenance.
  assert.deepEqual(await res.json(), [{ ...CAMPUS, last_edit: null }]);
  assert.deepEqual(db.calls[1].args, [
    { where: { schoolId: SCHOOL_ID }, orderBy: { name: "asc" }, include: { updatedBy: { select: { display_name: true } } } },
  ]);
  assertSchema();
});

test("GET /schools/[id]/campuses : école inconnue → 404, campus non lus", async () => {
  // Décision 14 (14 octobre 2026) : avant, une liste vide.
  db.use({ school: { findUnique: () => null }, campus: { findMany: () => [] } });

  const res = await h.listCampuses(get(), id("absent"));

  assert.equal(res.status, 404);
  assert.ok(!db.calls.some((c) => c.model === "campus"));
});

test("POST /schools/[id]/campuses : nom absent ou fait d'espaces → 400, rien d'écrit", async () => {
  for (const payload of [{}, { city: "Caen" }, { name: "   " }]) {
    db.use({ school: { findUnique: () => SCHOOL }, campus: { findUnique: () => null, create: () => CAMPUS } });
    assert.equal((await h.createCampus(body(payload), id(SCHOOL_ID))).status, 400, JSON.stringify(payload));
    assert.deepEqual(db.writes(), [], JSON.stringify(payload));
  }
});

test("POST /schools/[id]/campuses : école inconnue → 404 ; nom déjà pris → 400", async () => {
  db.use({ school: { findUnique: () => null } });
  assert.equal((await h.createCampus(body({ name: "Caen" }), id("absent"))).status, 404);

  db.use({ school: { findUnique: () => SCHOOL }, campus: { findUnique: () => CAMPUS, create: () => CAMPUS } });
  assert.equal((await h.createCampus(body({ name: "Caen" }), id(SCHOOL_ID))).status, 400);
  assert.deepEqual(db.writes(), []);
});

test("POST /schools/[id]/campuses : 201, nom et ville nettoyés, ville vide → null", async () => {
  db.use({
    school: { findUnique: () => SCHOOL },
    campus: { findUnique: () => null, create: ({ data }: { data: object }) => ({ id: "c-new", ...data }) },
  });

  const res = await h.createCampus(body({ name: " Le Havre ", city: "  " }), id(SCHOOL_ID));

  assert.equal(res.status, 201);
  assert.deepEqual(contentOf((db.writes()[0].args[0] as { data: object }).data, "test-gestionnaire"), { schoolId: SCHOOL_ID, name: "Le Havre", city: null });
  assertSchema();
});

// ── /api/admin/campuses/[id] ─────────────────────────────────────────

test("PUT /campuses/[id] : aucun champ → 400 ; nom fait d'espaces → 400 ; rien d'écrit", async () => {
  for (const payload of [{}, { name: "  " }]) {
    // Le nom n'est pris par aucun autre campus : seul le contrôle du corps peut refuser.
    db.use({
      campus: { findUnique: ({ where }: { where: { id?: string } }) => (where.id ? CAMPUS : null), update: () => CAMPUS },
    });
    assert.equal((await h.updateCampus(body(payload, "PUT"), id(CAMPUS.id))).status, 400, JSON.stringify(payload));
    assert.deepEqual(db.writes(), [], JSON.stringify(payload));
  }
});

test("PUT /campuses/[id] : inconnu → 404 ; nom pris dans l'école → 400", async () => {
  db.use({ campus: { findUnique: () => null } });
  assert.equal((await h.updateCampus(body({ city: "Caen" }, "PUT"), id("absent"))).status, 404);

  db.use({
    campus: {
      findUnique: ({ where }: { where: { id?: string } }) => (where.id ? CAMPUS : { id: "campus-havre" }),
      update: () => CAMPUS,
    },
  });
  assert.equal((await h.updateCampus(body({ name: "Le Havre" }, "PUT"), id(CAMPUS.id))).status, 400);
  assert.deepEqual(db.writes(), []);
});

test("PUT /campuses/[id] : 200, unicité cherchée dans l'école du campus, ville vide → null", async () => {
  db.use({
    campus: {
      findUnique: ({ where }: { where: { id?: string } }) => (where.id ? CAMPUS : null),
      update: ({ data }: { data: object }) => ({ ...CAMPUS, ...data }),
    },
  });

  const res = await h.updateCampus(body({ name: " Caen Centre ", city: "" }, "PUT"), id(CAMPUS.id));

  assert.equal(res.status, 200);
  assert.deepEqual(db.calls[1].args, [{ where: { schoolId_name: { schoolId: SCHOOL_ID, name: "Caen Centre" } } }]);
  assert.deepEqual(contentOf((db.writes()[0].args[0] as { data: object }).data, "test-gestionnaire"), { name: "Caen Centre", city: null });
  assertSchema();
});

test("DELETE /campuses/[id] : 404 ; sinon supprimé", async () => {
  db.use({ campus: { findUnique: () => null, delete: () => ({}) } });
  assert.equal((await h.deleteCampus(get(), id("absent"))).status, 404);
  assert.deepEqual(db.writes(), []);

  db.use({ campus: { findUnique: () => CAMPUS, delete: () => CAMPUS } });
  assert.equal((await h.deleteCampus(get(), id(CAMPUS.id))).status, 200);
  assert.deepEqual(db.writes()[0].args, [{ where: { id: CAMPUS.id } }]);
});

// ── Vues de lecture ──────────────────────────────────────────────────

test("GET /schools/[id]/manage : 404 ; sinon l'école et ses compteurs", async () => {
  db.use({ school: { findUnique: () => null } });
  assert.equal((await h.manage(get(), id("absent"))).status, 404);

  db.use({
    school: {
      findUnique: () => ({ ...SCHOOL, _count: { campuses: 2, programs: 5, accreditations: 1, statsRecords: 2 } }),
    },
    pricingRecord: { count: () => 7 },
    rankingRecord: { count: () => 3 },
    capacityRecord: { count: () => 4 },
    // Étape 8 (D50) : le compteur de l'onglet « Admissions ».
    programEntry: { count: () => 6 },
    schoolStatsRecord: { findMany: () => [{ academic_year: 2026 }, { academic_year: 2025 }] },
  });
  const res = await h.manage(get(), id(SCHOOL_ID));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json())._counts, {
    campuses: 2,
    programs: 5,
    accreditations: 1,
    statsRecords: 2,
    pricingRecords: 7,
    rankingRecords: 3,
    capacityRecords: 4,
    programEntries: 6,
    statsYears: [2026, 2025],
  });
  const entries = db.calls.find((c) => c.model === "programEntry")!.args[0] as { where: unknown };
  assert.deepEqual(entries.where, { program: { schoolId: SCHOOL_ID } });
  assertSchema();
});

test("GET /schools-with-programs : écoles ACTIVE, campus et programmes à plat", async () => {
  db.use({
    school: {
      findMany: () => [
        {
          ...SCHOOL,
          campuses: [{ id: CAMPUS.id, name: "Caen", programCampuses: [{ program: { id: "p-1", name: "PGE" } }] }],
        },
      ],
    },
  });

  const res = await h.schoolsWithPrograms(get(), id(""));

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), [
    {
      id: SCHOOL_ID,
      name: "Em Normandie",
      official_domain: "em-normandie.com",
      campuses: [{ id: CAMPUS.id, name: "Caen", programs: [{ id: "p-1", name: "PGE" }] }],
    },
  ]);
  assert.deepEqual((db.calls[0].args[0] as { where: object }).where, { status: "ACTIVE" });
  assertSchema();
});

// ── JSON mal formé : décision 10 du journal ──────────────────────────

test("JSON mal formé : 500 au lieu de 400 (décision 10 : consigné, non corrigé), rien d'écrit", async () => {
  // Défaut connu et accepté le 14 octobre 2026 : ces routes lisent le corps par
  // `request.json()` dans leur try, et l'erreur de syntaxe tombe dans le 500
  // générique. Aucune donnée n'est en jeu ; le back-office envoie toujours du
  // JSON valide. Si la décision change, ce test passe à 400.
  for (const name of ["createSchool", "updateSchool", "createCampus", "updateCampus"]) {
    db.use({ school: { findUnique: () => SCHOOL }, campus: { findUnique: () => CAMPUS } });
    const res = await quietly(() => h[name](body("{pas du json", "PUT"), id(SCHOOL_ID)));
    assert.equal(res.status, 500, name);
    assert.deepEqual(db.writes(), [], name);
  }
});
