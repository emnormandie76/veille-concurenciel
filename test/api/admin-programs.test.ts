/**
 * test/api/admin-programs.test.ts — CRUD admin des programmes et des capacités
 *
 *     npm run test:ts
 *
 * Plan backend-local, étape 7 (P2) : par route, 400 sur un corps invalide, 404
 * sur un id inconnu, le cas nominal. Chaque requête reçue est relue contre le
 * vrai schéma. Plan gestion-contenu, étape 1 (G4, D19) : tout se fait en
 * GESTIONNAIRE, suppression en cascade d'un programme comprise ; un USER est
 * refusé partout.
 *
 * Routes : /api/admin/schools/[id]/programs, /programs/[id],
 * /program-campuses/[id]/capacity, /capacities/[id], /schools/[id]/capacities.
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
  const programs = await import("../../app/api/admin/schools/[id]/programs/route");
  const program = await import("../../app/api/admin/programs/[id]/route");
  const pcCapacity = await import("../../app/api/admin/program-campuses/[id]/capacity/route");
  const capacity = await import("../../app/api/admin/capacities/[id]/route");
  const schoolCapacities = await import("../../app/api/admin/schools/[id]/capacities/route");
  Object.assign(h, {
    listPrograms: programs.GET,
    createProgram: programs.POST,
    updateProgram: program.PUT,
    deleteProgram: program.DELETE,
    createCapacity: pcCapacity.POST,
    updateCapacity: capacity.PUT,
    deleteCapacity: capacity.DELETE,
    listCapacities: schoolCapacities.GET,
  });
});

beforeEach(() => {
  session.as("GESTIONNAIRE");
});

const SCHOOL_ID = "school-normandie";
const SCHOOL = { id: SCHOOL_ID, name: "Em Normandie", status: "ACTIVE" };
const PROGRAM = { id: "p-pge", schoolId: SCHOOL_ID, name: "PGE" };
const PC = { id: "pc-caen", programId: PROGRAM.id, campusId: "campus-caen" };
const CAPACITY = { id: "cap-1", programCampusId: PC.id, academic_year: 2025, spots_available: 120 };
const MAX_YEAR = new Date().getFullYear() + 2;
const id = (value: string) => params({ id: value });

function assertSchema() {
  assert.deepEqual(schemaErrors(db.calls), []);
}

function dataOf(model: string, method: string) {
  return (db.writes().find((c) => c.model === model && c.method === method)?.args[0] as { data: Record<string, unknown> })
    ?.data;
}

// ── Gardes ───────────────────────────────────────────────────────────

test("sans session : 401 sur chaque handler, aucune requête", async () => {
  session.as("none");
  for (const [name, handler] of Object.entries(h)) {
    db.use({});
    assert.equal((await handler(body({}), id("x"))).status, 401, name);
    assert.deepEqual(db.calls, [], name);
  }
});

test("un USER reçoit 403 sur chaque handler, rien de lu", async () => {
  session.as("USER");
  for (const [name, handler] of Object.entries(h)) {
    db.use({});
    assert.equal((await handler(body({}), id("x"))).status, 403, name);
    assert.deepEqual(db.calls, [], name);
  }
});

// ── /api/admin/schools/[id]/programs ─────────────────────────────────

test("GET /schools/[id]/programs : 404 ; sinon les programmes et leurs campus à plat", async () => {
  db.use({ school: { findUnique: () => null } });
  assert.equal((await h.listPrograms(get(), id("absent"))).status, 404);

  db.use({
    school: { findUnique: () => SCHOOL },
    program: {
      findMany: () => [
        {
          ...PROGRAM,
          campus_policy_note: "note interne",
          _count: { pricingRecords: 2, rankingRecords: 1 },
          campuses: [{ id: PC.id, campus: { id: "campus-caen", name: "Caen", city: "Caen" } }],
        },
      ],
    },
  });
  const res = await h.listPrograms(get(), id(SCHOOL_ID));
  assert.equal(res.status, 200);
  const [program] = await res.json();
  assert.deepEqual(program.associatedCampuses, [
    { programCampusId: PC.id, campusId: "campus-caen", campusName: "Caen", campusCity: "Caen" },
  ]);
  assert.deepEqual(program._count, { pricingRecords: 2, rankingRecords: 1 });
  assertSchema();
});

const NEW_PROGRAM = { name: " MSc Data ", campusIds: ["campus-caen", "campus-havre"] };

function withSchoolForCreation(campuses = [{ id: "campus-caen" }, { id: "campus-havre" }]) {
  db.use({
    school: { findUnique: () => SCHOOL },
    program: { findUnique: () => null, create: ({ data }: { data: object }) => ({ id: "p-new", ...data }) },
    campus: { findMany: () => campuses },
    programCampus: { create: ({ data }: { data: object }) => ({ id: "pc-new", ...data }) },
  });
}

test("POST /schools/[id]/programs : nom ou campus manquants → 400, sans base", async () => {
  for (const payload of [{}, { name: "  ", campusIds: ["c"] }, { name: "MBA" }, { name: "MBA", campusIds: [] }, { name: "MBA", campusIds: "c" }]) {
    db.use({});
    assert.equal((await h.createProgram(body(payload), id(SCHOOL_ID))).status, 400, JSON.stringify(payload));
    assert.deepEqual(db.calls, []);
  }
});

test("POST /schools/[id]/programs : école inconnue → 404 ; nom pris → 400 ; campus d'une autre école → 400", async () => {
  db.use({ school: { findUnique: () => null } });
  assert.equal((await h.createProgram(body(NEW_PROGRAM), id("absent"))).status, 404);

  db.use({ school: { findUnique: () => SCHOOL }, program: { findUnique: () => PROGRAM, create: () => ({}) } });
  assert.equal((await h.createProgram(body(NEW_PROGRAM), id(SCHOOL_ID))).status, 400);
  assert.deepEqual(db.writes(), []);

  withSchoolForCreation([{ id: "campus-caen" }]);
  const res = await h.createProgram(body(NEW_PROGRAM), id(SCHOOL_ID));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /campus sélectionnés sont invalides/);
  const campusQuery = db.calls.find((c) => c.model === "campus")!.args[0] as { where: object };
  assert.deepEqual(campusQuery.where, { id: { in: NEW_PROGRAM.campusIds }, schoolId: SCHOOL_ID });
  assert.deepEqual(db.writes(), []);
});

test("POST /schools/[id]/programs : 201, un programme et un rattachement par campus", async () => {
  withSchoolForCreation();

  const res = await h.createProgram(
    body({ ...NEW_PROGRAM, admission_exam: " Tremplin ", is_alternance_possible: 1, max_internship_months: "12" }),
    id(SCHOOL_ID)
  );

  assert.equal(res.status, 201);
  // Étape 5 : l'écriture porte aussi sa provenance (contentOf la vérifie).
  assert.deepEqual(contentOf(dataOf("program", "create"), "test-gestionnaire"), {
    schoolId: SCHOOL_ID,
    name: "MSc Data",
    admission_exam: "Tremplin",
    is_alternance_possible: true,
    is_expatriation_mandatory: false,
    min_expatriation_months: null,
    max_internship_months: 12,
    source_url: null,
  });
  assert.deepEqual(
    db.writes().filter((c) => c.model === "programCampus").map((c) => (c.args[0] as { data: object }).data),
    [
      { programId: "p-new", campusId: "campus-caen" },
      { programId: "p-new", campusId: "campus-havre" },
    ]
  );
  assertSchema();
});

test("POST /schools/[id]/programs : un rattachement en échec annule le programme → 500, rien d'écrit", async () => {
  db.use({
    school: { findUnique: () => SCHOOL },
    program: { findUnique: () => null, create: () => ({ id: "p-new" }) },
    campus: { findMany: () => [{ id: "campus-caen" }, { id: "campus-havre" }] },
    programCampus: {
      create: ({ data }: { data: { campusId: string } }) => {
        if (data.campusId === "campus-havre") throw new Error("P2002");
        return {};
      },
    },
  });

  const res = await quietly(() => h.createProgram(body(NEW_PROGRAM), id(SCHOOL_ID)));

  assert.equal(res.status, 500);
  assert.deepEqual(db.writes(), []);
});

test("POST /schools/[id]/programs : une durée non numérique → 400, rien d'écrit", async () => {
  withSchoolForCreation();

  const res = await h.createProgram(body({ ...NEW_PROGRAM, min_expatriation_months: "six" }), id(SCHOOL_ID));

  // Décision 13 : NaN partirait vers Prisma, qui l'écrit en NULL.
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /min_expatriation_months/);
  assert.deepEqual(db.writes(), []);
});

// ── /api/admin/programs/[id] ─────────────────────────────────────────

function withProgram(currentCampusIds = ["campus-caen"], schoolCampusIds = ["campus-caen", "campus-havre"]) {
  db.use({
    program: {
      findUnique: ({ where }: { where: { id?: string } }) => (where.id ? PROGRAM : null),
      update: ({ data }: { data: object }) => ({ ...PROGRAM, ...data }),
    },
    campus: {
      findMany: ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((c) => schoolCampusIds.includes(c)).map((c) => ({ id: c })),
    },
    programCampus: {
      findMany: () => currentCampusIds.map((campusId) => ({ id: `pc-${campusId}`, campusId })),
      deleteMany: () => ({ count: 1 }),
      create: ({ data }: { data: object }) => data,
    },
  });
}

test("PUT /programs/[id] : programme inconnu → 404", async () => {
  db.use({ program: { findUnique: () => null } });

  assert.equal((await h.updateProgram(body({ name: "MBA" }, "PUT"), id("absent"))).status, 404);
});

test("PUT /programs/[id] : nom vide, nom pris, liste de campus vide → 400, rien d'écrit", async () => {
  for (const payload of [{ name: "   " }, { campusIds: [] }, { min_expatriation_months: "six" }]) {
    withProgram();
    assert.equal((await h.updateProgram(body(payload, "PUT"), id(PROGRAM.id))).status, 400, JSON.stringify(payload));
    assert.deepEqual(db.writes(), [], JSON.stringify(payload));
  }

  db.use({ program: { findUnique: () => PROGRAM, update: () => PROGRAM } });
  assert.equal((await h.updateProgram(body({ name: "MBA" }, "PUT"), id(PROGRAM.id))).status, 400);
  assert.deepEqual(db.writes(), []);
});

test("PUT /programs/[id] : un campus d'une autre école → 400, rien d'écrit", async () => {
  // Le rattachement ne doit jamais traverser les écoles : la création
  // (POST /schools/[id]/programs) le vérifie déjà.
  withProgram(["campus-caen"], ["campus-caen"]);

  const res = await h.updateProgram(body({ campusIds: ["campus-caen", "campus-lyon"] }, "PUT"), id(PROGRAM.id));

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /campus sélectionnés sont invalides/);
  const campusQuery = db.calls.find((c) => c.model === "campus")!.args[0] as { where: object };
  assert.deepEqual(campusQuery.where, { id: { in: ["campus-caen", "campus-lyon"] }, schoolId: SCHOOL_ID });
  assert.deepEqual(db.writes(), []);
});

test("PUT /programs/[id] : 200, champs nettoyés, campus retirés puis ajoutés", async () => {
  withProgram(["campus-caen"]);

  const res = await h.updateProgram(
    body({ admission_exam: "", is_expatriation_mandatory: "oui", campusIds: ["campus-havre"] }, "PUT"),
    id(PROGRAM.id)
  );

  assert.equal(res.status, 200);
  assert.deepEqual(contentOf(dataOf("program", "update"), "test-gestionnaire"), { admission_exam: null, is_expatriation_mandatory: true });
  assert.deepEqual((db.writes().find((c) => c.method === "deleteMany")!.args[0] as { where: object }).where, {
    programId: PROGRAM.id,
    campusId: { in: ["campus-caen"] },
  });
  assert.deepEqual(dataOf("programCampus", "create"), { programId: PROGRAM.id, campusId: "campus-havre" });
  assertSchema();
});

test("DELETE /programs/[id] : 404 ; sinon supprimé", async () => {
  db.use({ program: { findUnique: () => null, delete: () => ({}) } });
  assert.equal((await h.deleteProgram(get(), id("absent"))).status, 404);
  assert.deepEqual(db.writes(), []);

  db.use({ program: { findUnique: () => PROGRAM, delete: () => PROGRAM } });
  assert.equal((await h.deleteProgram(get(), id(PROGRAM.id))).status, 200);
  assert.deepEqual(db.writes()[0].args, [{ where: { id: PROGRAM.id } }]);
});

// ── Capacités ────────────────────────────────────────────────────────

test("POST /program-campuses/[id]/capacity : places ou année invalides → 400, sans base", async () => {
  for (const payload of [
    { academic_year: 2025 },
    { spots_available: -1, academic_year: 2025 },
    { spots_available: "beaucoup", academic_year: 2025 },
    { spots_available: 10 },
    { spots_available: 10, academic_year: 1999 },
    { spots_available: 10, academic_year: MAX_YEAR + 1 },
  ]) {
    db.use({});
    assert.equal((await h.createCapacity(body(payload), id(PC.id))).status, 400, JSON.stringify(payload));
    assert.deepEqual(db.calls, []);
  }
});

test("POST /program-campuses/[id]/capacity : rattachement inconnu → 404 ; année déjà saisie → 400", async () => {
  db.use({ programCampus: { findUnique: () => null } });
  assert.equal((await h.createCapacity(body({ spots_available: 10, academic_year: 2025 }), id("absent"))).status, 404);

  db.use({ programCampus: { findUnique: () => PC }, capacityRecord: { findUnique: () => CAPACITY, create: () => ({}) } });
  assert.equal((await h.createCapacity(body({ spots_available: 10, academic_year: 2025 }), id(PC.id))).status, 400);
  assert.deepEqual(db.writes(), []);
});

test("POST /program-campuses/[id]/capacity : 201, 0 place accepté, source nettoyée", async () => {
  db.use({
    programCampus: { findUnique: () => PC },
    capacityRecord: { findUnique: () => null, create: ({ data }: { data: object }) => ({ id: "cap-new", ...data }) },
  });

  const res = await h.createCapacity(body({ spots_available: "0", academic_year: "2026", source_url: "  " }), id(PC.id));

  assert.equal(res.status, 201);
  assert.deepEqual(contentOf(dataOf("capacityRecord", "create"), "test-gestionnaire"), {
    programCampusId: PC.id,
    spots_available: 0,
    academic_year: 2026,
    source_url: null,
  });
  assertSchema();
});

test("PUT /capacities/[id] : 404 ; places ou année invalides → 400 ; année déjà saisie → 400", async () => {
  db.use({ capacityRecord: { findUnique: () => null } });
  assert.equal((await h.updateCapacity(body({ spots_available: 5 }, "PUT"), id("absent"))).status, 404);

  for (const payload of [{ spots_available: -3 }, { academic_year: "deux-mille" }, { academic_year: MAX_YEAR + 1 }]) {
    db.use({ capacityRecord: { findUnique: () => CAPACITY, update: () => CAPACITY } });
    assert.equal((await h.updateCapacity(body(payload, "PUT"), id(CAPACITY.id))).status, 400, JSON.stringify(payload));
    assert.deepEqual(db.writes(), []);
  }

  db.use({
    capacityRecord: {
      findUnique: ({ where }: { where: { id?: string } }) => (where.id ? CAPACITY : { id: "cap-2026" }),
      update: () => CAPACITY,
    },
  });
  assert.equal((await h.updateCapacity(body({ academic_year: 2026 }, "PUT"), id(CAPACITY.id))).status, 400);
  assert.deepEqual(db.writes(), []);
});

test("PUT /capacities/[id] : 200, seuls les champs fournis sont écrits", async () => {
  db.use({
    capacityRecord: {
      findUnique: ({ where }: { where: { id?: string } }) => (where.id ? CAPACITY : null),
      update: ({ data }: { data: object }) => ({ ...CAPACITY, ...data }),
    },
  });

  const res = await h.updateCapacity(body({ spots_available: 90, academic_year: 2026 }, "PUT"), id(CAPACITY.id));

  assert.equal(res.status, 200);
  assert.deepEqual(contentOf(dataOf("capacityRecord", "update"), "test-gestionnaire"), { spots_available: 90, academic_year: 2026 });
  assertSchema();
});

test("DELETE /capacities/[id] : 404 ; sinon supprimée", async () => {
  db.use({ capacityRecord: { findUnique: () => null, delete: () => ({}) } });
  assert.equal((await h.deleteCapacity(get(), id("absent"))).status, 404);

  db.use({ capacityRecord: { findUnique: () => CAPACITY, delete: () => CAPACITY } });
  assert.equal((await h.deleteCapacity(get(), id(CAPACITY.id))).status, 200);
  assert.deepEqual(db.writes()[0].args, [{ where: { id: CAPACITY.id } }]);
});

test("GET /schools/[id]/capacities : 404 ; sinon les capacités de l'école et ses années", async () => {
  db.use({ school: { findUnique: () => null } });
  assert.equal((await h.listCapacities(get(), id("absent"))).status, 404);

  let call = 0;
  db.use({
    school: { findUnique: () => SCHOOL },
    capacityRecord: { findMany: () => (call++ === 0 ? [CAPACITY] : [{ academic_year: 2025 }]) },
  });
  const res = await h.listCapacities(get("http://localhost/x?year=2025"), id(SCHOOL_ID));
  assert.equal(res.status, 200);
  // D29 : chaque ligne lue porte « Modifié par … le … », `null` sans provenance.
  assert.deepEqual(await res.json(), { availableYears: [2025], records: [{ ...CAPACITY, last_edit: null }] });
  assert.deepEqual((db.calls[1].args[0] as { where: object }).where, {
    programCampus: { campus: { schoolId: SCHOOL_ID } },
    academic_year: 2025,
  });
  assertSchema();
});

// ── JSON mal formé : D120 ────────────────────────────────────────────

test("D120 : un JSON mal formé, ou qui n'est pas un objet, rend 400 ; rien d'écrit", async () => {
  // Le 500 de la décision 10 (plan backend-local), corrigé le 23 octobre 2026
  // (voir admin-schools.test.ts).
  for (const name of ["createProgram", "updateProgram", "createCapacity", "updateCapacity"]) {
    for (const raw of ["{pas du json", "[]", "null", "42"]) {
      db.use({ program: { findUnique: () => PROGRAM }, capacityRecord: { findUnique: () => CAPACITY } });
      const res = await quietly(() => h[name](body(raw, "PUT"), id("x")));
      assert.equal(res.status, 400, `${name} ${raw}`);
      assert.deepEqual(await res.json(), { error: "Corps de requête JSON invalide." }, name);
      assert.deepEqual(db.writes(), [], name);
    }
  }
});
