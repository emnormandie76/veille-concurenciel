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
let getSchool: Handler;
let getProgram: Handler;

before(async () => {
  ({ GET: getSchool } = await import("../../app/api/schools/[id]/route"));
  ({ GET: getProgram } = await import("../../app/api/schools/[id]/programs/[pid]/route"));
});

const SCHOOL_ID = "school-normandie";
const SCHOOL = { id: SCHOOL_ID, name: "Em Normandie", official_domain: "em-normandie.com", status: "ACTIVE" };
const PROGRAM = { id: "p-pge", schoolId: SCHOOL_ID, name: "PGE", school: SCHOOL, campuses: [], pricingRecords: [], rankingRecords: [] };
const INTERNAL = "P1001 postgresql://neondb_owner:motdepasse@ep-interne.neon.tech/neondb";

function assertSchema() {
  assert.deepEqual(schemaErrors(db.calls), []);
  // Tables jamais exposées (architecture.md §8.9).
  assert.doesNotMatch(JSON.stringify(db.calls.map((c) => c.args)), /contributions|password_hash|ai_extracted_json/);
}

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
