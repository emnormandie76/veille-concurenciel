/**
 * test/api/public-schools.test.ts — Routes publiques du site : /api/schools/**
 *
 *     npm run test:ts
 *
 * Plan backend-local, étape 7 (P2) : écoles `ACTIVE` seulement ; 404 ; une
 * erreur Prisma → 500 sans le message interne. Chaque requête reçue est relue
 * contre le vrai schéma Prisma.
 */

import { before, test } from "node:test";
import assert from "node:assert/strict";

import { installFakePrisma } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";
import { get, params, quietly } from "../helpers/requests";

const db = installFakePrisma();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (request: Request, ctx: { params: Promise<any> }) => Promise<Response>;
let getSchools: (request: Request) => Promise<Response>;
let getSchool: Handler;
let getProgram: Handler;

before(async () => {
  ({ GET: getSchools } = await import("../../app/api/schools/route"));
  ({ GET: getSchool } = await import("../../app/api/schools/[id]/route"));
  ({ GET: getProgram } = await import("../../app/api/schools/[id]/programs/[pid]/route"));
});

const SCHOOL_ID = "school-normandie";
const SCHOOL = { id: SCHOOL_ID, name: "Em Normandie", official_domain: "em-normandie.com", status: "ACTIVE" };
const PROGRAM = { id: "p-pge", schoolId: SCHOOL_ID, name: "PGE", school: SCHOOL, campuses: [], pricingRecords: [], rankingRecords: [] };
const INTERNAL = "P1001 postgresql://neondb_owner:motdepasse@ep-interne.neon.tech/neondb";

function assertSchema() {
  assert.deepEqual(schemaErrors(db.calls), []);
  // Tables jamais exposées (API-rest.md, « Tables exclues de toute réponse »).
  assert.doesNotMatch(JSON.stringify(db.calls.map((c) => c.args)), /contributions|password_hash|ai_extracted_json/);
}

// ── /api/schools ─────────────────────────────────────────────────────

// Plan gestion-contenu, D75 (contrôle du 21 octobre) : l'accueil comptait les
// programmes à travers leurs campus (51 pour 46 ; Em Lyon, 24 programmes dont
// 15 sans campus, en montrait 9). La liste rend le nombre de programmes de
// chaque école, celui de sa fiche.
test("GET /api/schools : chaque école dit son nombre de programmes, avec ou sans campus (D75)", async () => {
  const row = {
    ...SCHOOL,
    _count: { programs: 24 },
    campuses: [{ id: "c-1", name: "Lyon", city: "Lyon", programCampuses: [{ program: { id: "p-1", name: "PGE", admission_exam: null, is_alternance_possible: false, is_expatriation_mandatory: false } }] }],
  };
  db.use({ school: { findMany: () => [row], count: () => 1 } });

  const res = await getSchools(get("http://localhost/api/schools?limit=50"));

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data[0].programs_count, 24);
  assert.equal(body.data[0].campuses[0].programs.length, 1, "les programmes par campus restent, pour la navigation");
  assert.equal("_count" in body.data[0], false);
  const findMany = db.calls.find((c) => c.model === "school" && c.method === "findMany")!;
  const args = findMany.args[0] as { where: { status: string }; select: { _count: unknown } };
  assert.equal(args.where.status, "ACTIVE");
  assert.deepEqual(args.select._count, { select: { programs: true } });
  assertSchema();
});

// ── /api/schools/[id] ────────────────────────────────────────────────

test("GET /api/schools/[id] : absente ou non ACTIVE → 404", async () => {
  for (const school of [null, { ...SCHOOL, status: "INACTIVE" }, { ...SCHOOL, status: "DRAFT" }]) {
    db.use({ school: { findUnique: () => school } });
    const res = await getSchool(get(), params({ id: SCHOOL_ID }));
    assert.equal(res.status, 404, JSON.stringify(school));
    assert.deepEqual(Object.keys(await res.json()), ["error"]);
  }
});

test("GET /api/schools/[id] : 200, l'école avec campus, programmes, statistiques, accréditations", async () => {
  const full = { ...SCHOOL, campuses: [], programs: [], statsRecords: [], accreditations: [] };
  db.use({ school: { findUnique: () => full } });

  const res = await getSchool(get(), params({ id: SCHOOL_ID }));

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), full);
  assertSchema();
});

test("GET /api/schools/[id] : une erreur Prisma → 500 sans le message interne", async () => {
  db.use({
    school: {
      findUnique: () => {
        throw new Error(INTERNAL);
      },
    },
  });

  const res = await quietly(() => getSchool(get(), params({ id: SCHOOL_ID })));

  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /P1001|postgresql|motdepasse/);
});

// ── /api/schools/[id]/programs/[pid] ─────────────────────────────────

test("GET /api/schools/[id]/programs/[pid] : absent, d'une autre école, ou école non ACTIVE → 404", async () => {
  for (const program of [
    null,
    { ...PROGRAM, schoolId: "school-lyon" },
    { ...PROGRAM, school: { ...SCHOOL, status: "INACTIVE" } },
  ]) {
    db.use({ program: { findUnique: () => program } });
    const res = await getProgram(get(), params({ id: SCHOOL_ID, pid: PROGRAM.id }));
    assert.equal(res.status, 404, JSON.stringify(program));
  }
});

test("GET /api/schools/[id]/programs/[pid] : 200, le programme avec tarifs, classements, capacités", async () => {
  db.use({ program: { findUnique: () => PROGRAM } });

  const res = await getProgram(get(), params({ id: SCHOOL_ID, pid: PROGRAM.id }));

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), PROGRAM);
  assert.deepEqual((db.calls[0].args[0] as { where: object }).where, { id: PROGRAM.id });
  assertSchema();
});

test("GET /api/schools/[id]/programs/[pid] : une erreur Prisma → 500 sans le message interne", async () => {
  db.use({
    program: {
      findUnique: () => {
        throw new Error(INTERNAL);
      },
    },
  });

  const res = await quietly(() => getProgram(get(), params({ id: SCHOOL_ID, pid: PROGRAM.id })));

  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /P1001|postgresql|motdepasse/);
});
