/**
 * test/api/admin-records.test.ts — CRUD admin des tarifs, classements, accréditations, statistiques
 *
 *     npm run test:ts
 *
 * Plan backend-local, étape 7 (P2) : par route, 400 sur un corps invalide, 404
 * sur un id inconnu, le cas nominal. Chaque requête reçue est relue contre le
 * vrai schéma Prisma.
 *
 * Routes : /api/admin/programs/[id]/pricing, /pricing/[id],
 * /schools/[id]/pricing ; /programs/[id]/rankings, /rankings/[id],
 * /schools/[id]/rankings ; /schools/[id]/accreditations, /accreditations/[id] ;
 * /schools/[id]/stats, /schools/[id]/stats/[recordId].
 */

import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { installFakePrisma } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";
import { body, get, params, quietly } from "../helpers/requests";
import { installSession } from "../helpers/session";

const db = installFakePrisma();
const session = installSession();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (request: Request, ctx: { params: Promise<any> }) => Promise<Response>;
const h: Record<string, Handler> = {};

before(async () => {
  const programPricing = await import("../../app/api/admin/programs/[id]/pricing/route");
  const pricing = await import("../../app/api/admin/pricing/[id]/route");
  const schoolPricing = await import("../../app/api/admin/schools/[id]/pricing/route");
  const programRankings = await import("../../app/api/admin/programs/[id]/rankings/route");
  const ranking = await import("../../app/api/admin/rankings/[id]/route");
  const schoolRankings = await import("../../app/api/admin/schools/[id]/rankings/route");
  const accreditations = await import("../../app/api/admin/schools/[id]/accreditations/route");
  const accreditation = await import("../../app/api/admin/accreditations/[id]/route");
  const stats = await import("../../app/api/admin/schools/[id]/stats/route");
  const statsRecord = await import("../../app/api/admin/schools/[id]/stats/[recordId]/route");
  Object.assign(h, {
    upsertPricing: programPricing.PUT,
    deletePricing: pricing.DELETE,
    listPricing: schoolPricing.GET,
    createRanking: programRankings.POST,
    updateRanking: ranking.PUT,
    deleteRanking: ranking.DELETE,
    listRankings: schoolRankings.GET,
    listAccreditations: accreditations.GET,
    createAccreditation: accreditations.POST,
    updateAccreditation: accreditation.PUT,
    deleteAccreditation: accreditation.DELETE,
    getStats: stats.GET,
    upsertStats: stats.PUT,
    deleteStats: statsRecord.DELETE,
  });
});

beforeEach(() => {
  session.as("ADMIN");
});

const SCHOOL_ID = "school-normandie";
const SCHOOL = { id: SCHOOL_ID, name: "Em Normandie", status: "ACTIVE" };
const PROGRAM = { id: "p-pge", schoolId: SCHOOL_ID, name: "PGE" };
const PRICING = { id: "pr-1", programId: PROGRAM.id, academic_year: 2025, total_fee: 48000 };
const RANKING = { id: "rk-1", programId: PROGRAM.id, academic_year: 2025, ranking_name: "Figaro", rank: 9 };
const ACCREDITATION = {
  id: "ac-1",
  schoolId: SCHOOL_ID,
  accreditation_name: "EQUIS",
  accreditation_type: "international",
  year_obtained: 2015,
  is_active: true,
};
const STATS = { id: "st-1", schoolId: SCHOOL_ID, academic_year: 2025, total_students: 8000 };
const MAX_YEAR = new Date().getFullYear() + 2;
const id = (value: string) => params({ id: value });

function assertSchema() {
  assert.deepEqual(schemaErrors(db.calls), []);
}

function written(method: string) {
  return db.writes().find((c) => c.method === method)?.args[0] as Record<string, Record<string, unknown>>;
}

/** Un `findUnique` qui rend `record` par id, et `duplicate` par clé composée. */
const byId =
  (record: object, duplicate: object | null = null) =>
  ({ where }: { where: { id?: string } }) =>
    where.id ? record : duplicate;

test("sans session : 401 sur chaque handler, aucune requête", async () => {
  session.as("none");
  for (const [name, handler] of Object.entries(h)) {
    db.use({});
    assert.equal((await handler(body({}), params({ id: SCHOOL_ID, recordId: "st-1" }))).status, 401, name);
    assert.deepEqual(db.calls, [], name);
  }
});

// ── Tarifs ───────────────────────────────────────────────────────────

test("PUT /programs/[id]/pricing : année invalide ou aucun tarif → 400, sans base", async () => {
  for (const payload of [
    { total_fee: 48000 },
    { academic_year: "abc", total_fee: 48000 },
    { academic_year: 1999, total_fee: 48000 },
    { academic_year: 2025 },
    { academic_year: 2025, total_fee: "", currency: "EUR" },
  ]) {
    db.use({});
    assert.equal((await h.upsertPricing(body(payload, "PUT"), id(PROGRAM.id))).status, 400, JSON.stringify(payload));
    assert.deepEqual(db.calls, []);
  }
});

test("PUT /programs/[id]/pricing : un tarif non numérique → 400, rien d'écrit", async () => {
  db.use({ program: { findUnique: () => PROGRAM }, pricingRecord: { upsert: () => PRICING } });

  const res = await h.upsertPricing(body({ academic_year: 2025, total_fee: "quarante mille" }, "PUT"), id(PROGRAM.id));

  // Décision 13 : NaN partirait vers Prisma, qui l'écrit en NULL et efface le
  // tarif existant (vérifié en capturant le SQL, 14 octobre 2026).
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /total_fee/);
  assert.deepEqual(db.writes(), []);
});

test("PUT /programs/[id]/pricing : programme inconnu → 404 ; sinon upsert par (programme, année)", async () => {
  db.use({ program: { findUnique: () => null } });
  assert.equal((await h.upsertPricing(body({ academic_year: 2025, total_fee: 1 }, "PUT"), id("absent"))).status, 404);

  db.use({ program: { findUnique: () => PROGRAM }, pricingRecord: { upsert: () => PRICING } });
  const res = await h.upsertPricing(
    body({ academic_year: "2025", total_fee: "48000", year_1_fee: 12000, source_url: " https://em-normandie.com/tarifs " }, "PUT"),
    id(PROGRAM.id)
  );
  assert.equal(res.status, 200);
  const upsert = written("upsert");
  assert.deepEqual(upsert.where, { programId_academic_year: { programId: PROGRAM.id, academic_year: 2025 } });
  assert.equal(upsert.update.currency, "EUR");
  assert.equal(upsert.update.total_fee, 48000);
  assert.equal(upsert.update.year_2_fee, null);
  assert.equal(upsert.update.source_url, "https://em-normandie.com/tarifs");
  assert.deepEqual(upsert.create, { programId: PROGRAM.id, academic_year: 2025, ...upsert.update });
  assertSchema();
});

test("DELETE /pricing/[id] : 404 ; sinon supprimé", async () => {
  db.use({ pricingRecord: { findUnique: () => null, delete: () => ({}) } });
  assert.equal((await h.deletePricing(get(), id("absent"))).status, 404);
  assert.deepEqual(db.writes(), []);

  db.use({ pricingRecord: { findUnique: () => PRICING, delete: () => PRICING } });
  assert.equal((await h.deletePricing(get(), id(PRICING.id))).status, 200);
  assert.deepEqual(db.writes()[0].args, [{ where: { id: PRICING.id } }]);
});

for (const [name, model, record] of [
  ["listPricing", "pricingRecord", PRICING],
  ["listRankings", "rankingRecord", RANKING],
] as const) {
  test(`GET /schools/[id]/${name === "listPricing" ? "pricing" : "rankings"} : 404 ; sinon les lignes de l'école et ses années`, async () => {
    db.use({ school: { findUnique: () => null } });
    assert.equal((await h[name](get(), id("absent"))).status, 404);

    let call = 0;
    db.use({
      school: { findUnique: () => SCHOOL },
      [model]: { findMany: () => (call++ === 0 ? [record] : [{ academic_year: 2025 }]) },
    });
    const res = await h[name](get(`http://localhost/x?year=2025&programId=${PROGRAM.id}`), id(SCHOOL_ID));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { availableYears: [2025], records: [record] });
    assert.deepEqual((db.calls[1].args[0] as { where: object }).where, {
      program: { schoolId: SCHOOL_ID },
      academic_year: 2025,
      programId: PROGRAM.id,
    });
    assertSchema();
  });
}

// ── Classements ──────────────────────────────────────────────────────

test("POST /programs/[id]/rankings : nom, rang ou année invalides → 400, sans base", async () => {
  for (const payload of [
    { rank: 3, academic_year: 2025 },
    { ranking_name: "  ", rank: 3, academic_year: 2025 },
    { ranking_name: "Figaro", rank: 0, academic_year: 2025 },
    { ranking_name: "Figaro", rank: "premier", academic_year: 2025 },
    { ranking_name: "Figaro", rank: 3, academic_year: MAX_YEAR + 1 },
  ]) {
    db.use({});
    assert.equal((await h.createRanking(body(payload), id(PROGRAM.id))).status, 400, JSON.stringify(payload));
    assert.deepEqual(db.calls, []);
  }
});

test("POST /programs/[id]/rankings : 404 ; doublon (programme, année, nom) → 400 ; sinon 201", async () => {
  const payload = { ranking_name: " Figaro ", rank: "9", academic_year: 2025, source_url: "" };
  db.use({ program: { findUnique: () => null } });
  assert.equal((await h.createRanking(body(payload), id("absent"))).status, 404);

  db.use({ program: { findUnique: () => PROGRAM }, rankingRecord: { findUnique: () => RANKING, create: () => RANKING } });
  assert.equal((await h.createRanking(body(payload), id(PROGRAM.id))).status, 400);
  assert.deepEqual(db.writes(), []);

  db.use({ program: { findUnique: () => PROGRAM }, rankingRecord: { findUnique: () => null, create: () => RANKING } });
  assert.equal((await h.createRanking(body(payload), id(PROGRAM.id))).status, 201);
  assert.deepEqual(written("create").data, {
    programId: PROGRAM.id,
    ranking_name: "Figaro",
    rank: 9,
    academic_year: 2025,
    source_url: null,
  });
  assertSchema();
});

test("PUT /rankings/[id] : 404 ; nom vide, rang ou année invalides → 400 ; doublon → 400", async () => {
  db.use({ rankingRecord: { findUnique: () => null } });
  assert.equal((await h.updateRanking(body({ rank: 3 }, "PUT"), id("absent"))).status, 404);

  for (const payload of [{ ranking_name: " " }, { rank: -1 }, { academic_year: 1999 }]) {
    db.use({ rankingRecord: { findUnique: byId(RANKING), update: () => RANKING } });
    assert.equal((await h.updateRanking(body(payload, "PUT"), id(RANKING.id))).status, 400, JSON.stringify(payload));
    assert.deepEqual(db.writes(), []);
  }

  db.use({ rankingRecord: { findUnique: byId(RANKING, { id: "rk-autre" }), update: () => RANKING } });
  assert.equal((await h.updateRanking(body({ academic_year: 2026 }, "PUT"), id(RANKING.id))).status, 400);
  assert.deepEqual(db.writes(), []);
});

test("PUT /rankings/[id] : 200, doublon cherché sur la nouvelle clé, seuls les champs fournis écrits", async () => {
  db.use({ rankingRecord: { findUnique: byId(RANKING), update: () => RANKING } });

  const res = await h.updateRanking(body({ ranking_name: "Challenges", rank: "4" }, "PUT"), id(RANKING.id));

  assert.equal(res.status, 200);
  assert.deepEqual(db.calls[1].args, [
    {
      where: {
        programId_academic_year_ranking_name: { programId: PROGRAM.id, academic_year: 2025, ranking_name: "Challenges" },
      },
    },
  ]);
  assert.deepEqual(written("update").data, { ranking_name: "Challenges", rank: 4 });
  assertSchema();
});

test("DELETE /rankings/[id] : 404 ; sinon supprimé", async () => {
  db.use({ rankingRecord: { findUnique: () => null, delete: () => ({}) } });
  assert.equal((await h.deleteRanking(get(), id("absent"))).status, 404);

  db.use({ rankingRecord: { findUnique: () => RANKING, delete: () => RANKING } });
  assert.equal((await h.deleteRanking(get(), id(RANKING.id))).status, 200);
  assert.deepEqual(db.writes()[0].args, [{ where: { id: RANKING.id } }]);
});

// ── Accréditations ───────────────────────────────────────────────────

test("GET /schools/[id]/accreditations : 404 ; sinon par nom", async () => {
  db.use({ school: { findUnique: () => null } });
  assert.equal((await h.listAccreditations(get(), id("absent"))).status, 404);

  db.use({ school: { findUnique: () => SCHOOL }, accreditationRecord: { findMany: () => [ACCREDITATION] } });
  const res = await h.listAccreditations(get(), id(SCHOOL_ID));
  assert.deepEqual(await res.json(), [ACCREDITATION]);
  assertSchema();
});

test("POST /schools/[id]/accreditations : nom, type ou année invalides → 400, sans base", async () => {
  for (const payload of [
    { accreditation_type: "label" },
    { accreditation_name: "AACSB", accreditation_type: "mondial" },
    { accreditation_name: "AACSB", accreditation_type: "international", year_obtained: 1990 },
    { accreditation_name: "AACSB", accreditation_type: "international", year_obtained: "jadis" },
  ]) {
    db.use({});
    assert.equal((await h.createAccreditation(body(payload), id(SCHOOL_ID))).status, 400, JSON.stringify(payload));
    assert.deepEqual(db.calls, []);
  }
});

test("POST /schools/[id]/accreditations : 404 ; doublon → 400 ; sinon 201, année vide → null, active par défaut", async () => {
  const payload = { accreditation_name: " AACSB ", accreditation_type: "international", year_obtained: "" };
  db.use({ school: { findUnique: () => null } });
  assert.equal((await h.createAccreditation(body(payload), id("absent"))).status, 404);

  db.use({ school: { findUnique: () => SCHOOL }, accreditationRecord: { findUnique: () => ACCREDITATION, create: () => ({}) } });
  assert.equal((await h.createAccreditation(body(payload), id(SCHOOL_ID))).status, 400);
  assert.deepEqual(db.writes(), []);

  db.use({ school: { findUnique: () => SCHOOL }, accreditationRecord: { findUnique: () => null, create: () => ACCREDITATION } });
  assert.equal((await h.createAccreditation(body(payload), id(SCHOOL_ID))).status, 201);
  assert.deepEqual(written("create").data, {
    schoolId: SCHOOL_ID,
    accreditation_name: "AACSB",
    accreditation_type: "international",
    year_obtained: null,
    is_active: true,
  });
  assertSchema();
});

test("PUT /accreditations/[id] : 404 ; nom vide, type ou année invalides → 400 ; nom pris → 400", async () => {
  db.use({ accreditationRecord: { findUnique: () => null } });
  assert.equal((await h.updateAccreditation(body({ is_active: false }, "PUT"), id("absent"))).status, 404);

  for (const payload of [{ accreditation_name: "" }, { accreditation_type: "state-ish" }, { year_obtained: MAX_YEAR + 1 }]) {
    db.use({ accreditationRecord: { findUnique: byId(ACCREDITATION), update: () => ACCREDITATION } });
    const res = await h.updateAccreditation(body(payload, "PUT"), id(ACCREDITATION.id));
    assert.equal(res.status, 400, JSON.stringify(payload));
    assert.deepEqual(db.writes(), []);
  }

  db.use({ accreditationRecord: { findUnique: byId(ACCREDITATION, { id: "ac-2" }), update: () => ACCREDITATION } });
  assert.equal((await h.updateAccreditation(body({ accreditation_name: "AMBA" }, "PUT"), id(ACCREDITATION.id))).status, 400);
  assert.deepEqual(db.writes(), []);
});

test("PUT /accreditations/[id] : 200, année vide → null, is_active booléen", async () => {
  db.use({ accreditationRecord: { findUnique: byId(ACCREDITATION), update: () => ACCREDITATION } });

  const res = await h.updateAccreditation(body({ year_obtained: "", is_active: 0 }, "PUT"), id(ACCREDITATION.id));

  assert.equal(res.status, 200);
  assert.deepEqual(written("update").data, { year_obtained: null, is_active: false });
  assertSchema();
});

test("DELETE /accreditations/[id] : 404 ; sinon supprimée", async () => {
  db.use({ accreditationRecord: { findUnique: () => null, delete: () => ({}) } });
  assert.equal((await h.deleteAccreditation(get(), id("absent"))).status, 404);

  db.use({ accreditationRecord: { findUnique: () => ACCREDITATION, delete: () => ACCREDITATION } });
  assert.equal((await h.deleteAccreditation(get(), id(ACCREDITATION.id))).status, 200);
});

// ── Statistiques ─────────────────────────────────────────────────────

test("GET /schools/[id]/stats : 404 ; sans année, la plus récente ; avec année, celle-là", async () => {
  db.use({ school: { findUnique: () => null } });
  assert.equal((await h.getStats(get(), id("absent"))).status, 404);

  db.use({
    school: { findUnique: () => SCHOOL },
    schoolStatsRecord: { findMany: () => [{ academic_year: 2025 }, { academic_year: 2024 }], findUnique: () => STATS },
  });
  const res = await h.getStats(get(), id(SCHOOL_ID));
  assert.deepEqual(await res.json(), { availableYears: [2025, 2024], record: STATS });
  assert.deepEqual((db.calls[2].args[0] as { where: object }).where, {
    schoolId_academic_year: { schoolId: SCHOOL_ID, academic_year: 2025 },
  });
  assertSchema();

  db.use({
    school: { findUnique: () => SCHOOL },
    schoolStatsRecord: { findMany: () => [{ academic_year: 2025 }], findUnique: () => null },
  });
  const other = await h.getStats(get("http://localhost/x?year=2024"), id(SCHOOL_ID));
  assert.deepEqual(await other.json(), { availableYears: [2025], record: null });
});

test("PUT /schools/[id]/stats : année invalide → 400, sans base ; école inconnue → 404", async () => {
  for (const payload of [{}, { academic_year: "abc" }, { academic_year: 1999 }, { academic_year: MAX_YEAR + 1 }]) {
    db.use({});
    assert.equal((await h.upsertStats(body(payload, "PUT"), id(SCHOOL_ID))).status, 400, JSON.stringify(payload));
    assert.deepEqual(db.calls, []);
  }

  db.use({ school: { findUnique: () => null } });
  assert.equal((await h.upsertStats(body({ academic_year: 2025 }, "PUT"), id("absent"))).status, 404);
});

test("PUT /schools/[id]/stats : 200, upsert par (école, année), vides → null", async () => {
  db.use({ school: { findUnique: () => SCHOOL }, schoolStatsRecord: { upsert: () => STATS } });

  const res = await h.upsertStats(
    body({ academic_year: "2025", total_students: "8000", total_alumni: "", international_professors_pct: "42.5" }, "PUT"),
    id(SCHOOL_ID)
  );

  assert.equal(res.status, 200);
  const upsert = written("upsert");
  assert.deepEqual(upsert.where, { schoolId_academic_year: { schoolId: SCHOOL_ID, academic_year: 2025 } });
  assert.equal(upsert.update.total_students, 8000);
  assert.equal(upsert.update.total_alumni, null);
  assert.equal(upsert.update.international_professors_pct, 42.5);
  assert.deepEqual(upsert.create, { schoolId: SCHOOL_ID, academic_year: 2025, ...upsert.update });
  assertSchema();
});

test("PUT /schools/[id]/stats : une valeur non numérique → 400, rien d'écrit", async () => {
  db.use({ school: { findUnique: () => SCHOOL }, schoolStatsRecord: { upsert: () => STATS } });

  const res = await h.upsertStats(
    body({ academic_year: 2025, total_students: "huit mille", external_speakers_pct: "un tiers" }, "PUT"),
    id(SCHOOL_ID)
  );

  // Décision 13 : NaN partirait vers Prisma, qui l'écrit en NULL.
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /total_students, external_speakers_pct/);
  assert.deepEqual(db.writes(), []);
});

test("DELETE /schools/[id]/stats/[recordId] : 404 ; ligne d'une autre école → 403 ; sinon supprimée", async () => {
  db.use({ schoolStatsRecord: { findUnique: () => null, delete: () => ({}) } });
  assert.equal((await h.deleteStats(get(), params({ id: SCHOOL_ID, recordId: "absent" }))).status, 404);

  db.use({ schoolStatsRecord: { findUnique: () => ({ ...STATS, schoolId: "school-lyon" }), delete: () => ({}) } });
  assert.equal((await h.deleteStats(get(), params({ id: SCHOOL_ID, recordId: STATS.id }))).status, 403);
  assert.deepEqual(db.writes(), []);

  db.use({ schoolStatsRecord: { findUnique: () => STATS, delete: () => STATS } });
  assert.equal((await h.deleteStats(get(), params({ id: SCHOOL_ID, recordId: STATS.id }))).status, 200);
  assert.deepEqual(db.writes()[0].args, [{ where: { id: STATS.id } }]);
});

// ── JSON mal formé : décision 10 du journal ──────────────────────────

test("JSON mal formé : 500 au lieu de 400 (décision 10 : consigné, non corrigé), rien d'écrit", async () => {
  // Défaut connu et accepté le 14 octobre 2026 (voir admin-schools.test.ts).
  for (const name of [
    "upsertPricing",
    "createRanking",
    "updateRanking",
    "createAccreditation",
    "updateAccreditation",
    "upsertStats",
  ]) {
    db.use({});
    const res = await quietly(() => h[name](body("{pas du json", "PUT"), id("x")));
    assert.equal(res.status, 500, name);
    assert.deepEqual(db.calls, [], name);
  }
});
