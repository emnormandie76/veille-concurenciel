/**
 * test/api/source-url.test.ts — Le lien source de chaque donnée saisie
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 5 :
 * - D27 : une seule règle pour tout lien source saisi à la main (tarifs,
 *   places, classements, chiffres clés, accréditations, programmes) : vide,
 *   pas de lien ; sinon une adresse http(s) de 2 048 caractères au plus,
 *   sinon 400, rien d'écrit ;
 * - D12 : les chiffres clés, les accréditations et les programmes ont enfin
 *   un lien source ; la validation de l'inbox écrit celui que portent les
 *   tickets Chiffres clés et Accréditations (il était jeté).
 */

import { afterEach, before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { installFakePrisma, type FakeModels, type FakePrismaCall } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";
import { body, get, params, quietly } from "../helpers/requests";
import { installSession } from "../helpers/session";

const db = installFakePrisma();
const session = installSession();
mock.module("next/cache", { exports: { revalidatePath: () => {} } });

afterEach(() => {
  assert.deepEqual(schemaErrors(db.calls), []);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (request: Request, ctx: { params: Promise<any> }) => Promise<Response>;

const SCHOOL = { id: "school-1", name: "Em Normandie", status: "ACTIVE" };
const CAMPUS = { id: "campus-1", schoolId: SCHOOL.id, name: "Caen" };
const PROGRAM = { id: "program-1", schoolId: SCHOOL.id, name: "PGE" };
const PC = { id: "pc-1", programId: PROGRAM.id, campusId: CAMPUS.id };
const CAPACITY = { id: "capacity-1", programCampusId: PC.id, academic_year: 2025, spots_available: 30 };
const RANKING = { id: "ranking-1", programId: PROGRAM.id, academic_year: 2025, ranking_name: "Figaro", rank: 9 };
const ACCREDITATION = { id: "accreditation-1", schoolId: SCHOOL.id, accreditation_name: "EQUIS", accreditation_type: "international", is_active: true };

const echo = (id: string) => (args: { data?: object; create?: object }) => ({ id, ...(args.data ?? args.create ?? {}) });
const byId = (row: object) => ({ where }: { where: { id?: string } }) => (where.id ? row : null);

interface Route {
  name: string;
  route: string;
  method: "POST" | "PUT";
  params: Record<string, string>;
  payload: Record<string, unknown>;
  models: FakeModels;
  /** « modèle.méthode » de l'écriture qui porte le lien. */
  write: string;
}

const ROUTES: Route[] = [
  {
    name: "tarif",
    route: "programs/[id]/pricing/route",
    method: "PUT",
    params: { id: PROGRAM.id },
    payload: { academic_year: 2025, total_fee: 48000 },
    models: { program: { findUnique: () => PROGRAM }, pricingRecord: { upsert: echo("pricing-1") } },
    write: "pricingRecord.upsert",
  },
  {
    name: "capacité (création)",
    route: "program-campuses/[id]/capacity/route",
    method: "POST",
    params: { id: PC.id },
    payload: { spots_available: 30, academic_year: 2025 },
    models: { programCampus: { findUnique: () => PC }, capacityRecord: { findUnique: () => null, create: echo("capacity-1") } },
    write: "capacityRecord.create",
  },
  {
    name: "capacité (modification)",
    route: "capacities/[id]/route",
    method: "PUT",
    params: { id: CAPACITY.id },
    payload: { spots_available: 40 },
    models: { capacityRecord: { findUnique: byId(CAPACITY), update: echo(CAPACITY.id) } },
    write: "capacityRecord.update",
  },
  {
    name: "classement (création)",
    route: "programs/[id]/rankings/route",
    method: "POST",
    params: { id: PROGRAM.id },
    payload: { ranking_name: "Challenges", rank: 12, academic_year: 2025 },
    models: { program: { findUnique: () => PROGRAM }, rankingRecord: { findUnique: () => null, create: echo("ranking-2") } },
    write: "rankingRecord.create",
  },
  {
    name: "classement (modification)",
    route: "rankings/[id]/route",
    method: "PUT",
    params: { id: RANKING.id },
    payload: { rank: 8 },
    models: { rankingRecord: { findUnique: byId(RANKING), update: echo(RANKING.id) } },
    write: "rankingRecord.update",
  },
  {
    name: "chiffres clés",
    route: "schools/[id]/stats/route",
    method: "PUT",
    params: { id: SCHOOL.id },
    payload: { academic_year: 2025, total_students: 9000 },
    models: { school: { findUnique: () => SCHOOL }, schoolStatsRecord: { upsert: echo("stats-1") } },
    write: "schoolStatsRecord.upsert",
  },
  {
    name: "accréditation (création)",
    route: "schools/[id]/accreditations/route",
    method: "POST",
    params: { id: SCHOOL.id },
    payload: { accreditation_name: "AACSB", accreditation_type: "international" },
    models: { school: { findUnique: () => SCHOOL }, accreditationRecord: { findUnique: () => null, create: echo("accreditation-2") } },
    write: "accreditationRecord.create",
  },
  {
    name: "accréditation (modification)",
    route: "accreditations/[id]/route",
    method: "PUT",
    params: { id: ACCREDITATION.id },
    payload: { is_active: false },
    models: { accreditationRecord: { findUnique: byId(ACCREDITATION), update: echo(ACCREDITATION.id) } },
    write: "accreditationRecord.update",
  },
  {
    name: "programme (création)",
    route: "schools/[id]/programs/route",
    method: "POST",
    params: { id: SCHOOL.id },
    payload: { name: "MSc Finance", campusIds: [CAMPUS.id] },
    models: {
      school: { findUnique: () => SCHOOL },
      program: { findUnique: () => null, create: echo("program-2") },
      campus: { findMany: () => [{ id: CAMPUS.id }] },
      programCampus: { create: echo("pc-2") },
    },
    write: "program.create",
  },
  {
    name: "programme (modification)",
    route: "programs/[id]/route",
    method: "PUT",
    params: { id: PROGRAM.id },
    payload: { name: "Programme Grande École" },
    models: { program: { findUnique: byId(PROGRAM), update: echo(PROGRAM.id) } },
    write: "program.update",
  },
];

const handlers = new Map<string, Handler>();

before(async () => {
  for (const r of [...ROUTES.map((x) => ({ route: x.route, method: x.method })), { route: "inbox/[id]/validate/route", method: "PUT" }, { route: "schools/[id]/programs/route", method: "GET" }]) {
    const mod = (await import(`../../app/api/admin/${r.route}`)) as Record<string, Handler>;
    handlers.set(`${r.method} ${r.route}`, mod[r.method]);
  }
});

beforeEach(() => {
  session.as("GESTIONNAIRE");
});

function call(r: Route, sourceUrl: unknown): Promise<Response> {
  db.use(r.models);
  return quietly(() => handlers.get(`${r.method} ${r.route}`)!(body({ ...r.payload, source_url: sourceUrl }, r.method), params(r.params)));
}

/** Le lien écrit : dans `data`, ou dans les deux branches d'un upsert. */
function writtenLinks(r: Route): unknown[] {
  const [model, method] = r.write.split(".");
  const call = db.writes().find((c: FakePrismaCall) => c.model === model && c.method === method);
  assert.ok(call, `${r.name} : ${r.write} attendu`);
  const args = call.args[0] as Record<string, Record<string, unknown>>;
  return method === "upsert" ? [args.create.source_url, args.update.source_url] : [args.data.source_url];
}

for (const r of ROUTES) {
  test(`${r.name} : un lien qui n'est pas une adresse web → 400, rien d'écrit (D27)`, async () => {
    for (const bad of ["javascript:alert(1)", "www.ecole.fr/tarifs", `https://ecole.fr/${"a".repeat(2048)}`, 42]) {
      const res = await call(r, bad);
      assert.equal(res.status, 400, `${r.name} : ${String(bad).slice(0, 30)}`);
      assert.match((await res.json()).error, /adresse web/);
      assert.deepEqual(db.writes(), [], r.name);
    }
  });

  test(`${r.name} : une adresse web est écrite sans ses espaces ; un champ vide efface le lien`, async () => {
    let res = await call(r, "  https://www.em-normandie.com/fr/source  ");
    assert.ok(res.ok, `${r.name} : ${res.status}`);
    for (const link of writtenLinks(r)) assert.equal(link, "https://www.em-normandie.com/fr/source", r.name);

    res = await call(r, "");
    assert.ok(res.ok, `${r.name} : ${res.status}`);
    for (const link of writtenLinks(r)) assert.equal(link, null, r.name);
  });
}

test("D12 : la liste des programmes du back-office rend leur lien source, pour l'onglet", async () => {
  db.use({
    school: { findUnique: () => SCHOOL },
    program: {
      findMany: () => [{ ...PROGRAM, source_url: "https://www.em-normandie.com/fr/pge", campuses: [], _count: { pricingRecords: 0, rankingRecords: 0 } }],
    },
  });
  const res = await handlers.get("GET schools/[id]/programs/route")!(get(), params({ id: SCHOOL.id }));
  assert.equal(res.status, 200);
  assert.equal((await res.json())[0].source_url, "https://www.em-normandie.com/fr/pge");
});

// ── D12 : la validation de l'inbox garde le lien des tickets ──

function validate(category: string, json: unknown, models: FakeModels): Promise<Response> {
  session.as("ADMIN");
  db.use({
    ...models,
    contributionInbox: {
      findUnique: () => ({ id: "ticket-1", status: "Pending_Admin", ai_category: category, schoolId: SCHOOL.id, programId: null, campusId: null, programCampusId: null, ai_extracted_json: json }),
      update: () => ({ id: "ticket-1" }),
    },
  });
  return quietly(() =>
    handlers.get("PUT inbox/[id]/validate/route")!(new Request("http://localhost/x", { method: "PUT" }), params({ id: "ticket-1" }))
  );
}

test("D12 : valider des chiffres clés écrit leur lien source", async () => {
  const res = await validate("SchoolStats", { academic_year: 2025, total_students: 9000, source_url: "https://www.em-normandie.com/fr/chiffres" }, {
    schoolStatsRecord: { upsert: echo("stats-1") },
  });
  assert.equal(res.status, 200);
  const args = db.writes().find((c) => c.model === "schoolStatsRecord")!.args[0] as Record<string, Record<string, unknown>>;
  assert.equal(args.create.source_url, "https://www.em-normandie.com/fr/chiffres");
  assert.equal(args.update.source_url, "https://www.em-normandie.com/fr/chiffres");
});

test("D12 : valider des accréditations écrit le lien de chacune", async () => {
  const res = await validate(
    "Accreditation",
    {
      accreditations: [
        { accreditation_name: "AACSB", accreditation_type: "international", source_url: "https://www.em-normandie.com/fr/aacsb" },
        { accreditation_name: "EQUIS", accreditation_type: "international" },
      ],
    },
    { accreditationRecord: { upsert: echo("accreditation-1") } }
  );
  assert.equal(res.status, 200);
  const links = db
    .writes()
    .filter((c) => c.model === "accreditationRecord")
    .map((c) => (c.args[0] as Record<string, Record<string, unknown>>).create.source_url);
  assert.deepEqual(links, ["https://www.em-normandie.com/fr/aacsb", null]);
});
