/**
 * test/api/manager-provenance.test.ts — Le gestionnaire dit qui a modifié chaque donnée, et quand
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 5, décision D29 (20 octobre) : dans le
 * gestionnaire, chaque donnée (l'école, ses campus, programmes, tarifs,
 * places, classements, chiffres clés et accréditations ; depuis l'étape 8,
 * les admissions de ses programmes, D49) montre le **nom** de
 * la personne qui l'a modifiée en dernier et la **date** : « Modifié par
 * Camille Martin le 19 octobre 2026 ». Ni l'origine (saisie, IA, signalement),
 * ni l'identifiant du compte, ni son adresse.
 *
 * Les routes de lecture du gestionnaire rendent ce texte, `last_edit`, prêt à
 * afficher (lib/provenance.ts, `forManager`, `describeLastEdit`). Elles ne
 * lisent de l'auteur que `display_name` ; chaque requête est relue contre le
 * vrai schéma Prisma.
 */

import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { installFakePrisma, type FakeModels } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";
import { get, params } from "../helpers/requests";
import { installSession } from "../helpers/session";

const db = installFakePrisma();
const session = installSession();

type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

const SCHOOL_ID = "school-1";
const AT = new Date("2026-10-19T08:30:00Z");
const LAST_EDIT = "Modifié par Camille Martin le 19 octobre 2026";
/** Ce que la base rend d'une ligne modifiée ; l'origine IA ne doit pas se voir. */
const PROV = { updated_at: AT, updated_via: "AI", updated_by_id: "u-camille", updatedBy: { display_name: "Camille Martin" } };
const UNTRACKED = { updated_at: null, updated_via: null, updated_by_id: null, updatedBy: null };

const SCHOOL = { id: SCHOOL_ID, name: "Em Normandie", official_domain: "em-normandie.com", status: "ACTIVE", ...PROV };
const CAMPUS = { id: "cp-1", schoolId: SCHOOL_ID, name: "Caen", city: "Caen", ...PROV };
const PROGRAM = {
  id: "pg-1",
  schoolId: SCHOOL_ID,
  name: "Programme Grande École",
  admission_exam: null,
  is_alternance_possible: true,
  is_expatriation_mandatory: false,
  min_expatriation_months: null,
  max_internship_months: null,
  campus_policy_note: null,
  source_url: null,
  ...PROV,
  campuses: [{ id: "pc-1", programId: "pg-1", campusId: "cp-1", campus: { id: "cp-1", name: "Caen", city: "Caen" } }],
  _count: { pricingRecords: 1, rankingRecords: 1 },
};
const PRICING = { id: "pr-1", programId: "pg-1", academic_year: 2026, total_fee: 45000, source_url: null, ...PROV, program: { id: "pg-1", name: "PGE" } };
const RANKING = { id: "rk-1", programId: "pg-1", academic_year: 2026, ranking_name: "Figaro", rank: 4, source_url: null, ...PROV, program: { id: "pg-1", name: "PGE" } };
const CAPACITY = {
  id: "cap-1",
  programCampusId: "pc-1",
  academic_year: 2026,
  spots_available: 120,
  source_url: null,
  ...PROV,
  programCampus: { id: "pc-1", program: { id: "pg-1", name: "PGE" }, campus: { id: "cp-1", name: "Caen", city: "Caen" } },
};
const STATS = { id: "st-1", schoolId: SCHOOL_ID, academic_year: 2026, total_students: 8000, source_url: null, ...PROV };
const ACCREDITATION = { id: "ac-1", schoolId: SCHOOL_ID, accreditation_name: "AACSB", accreditation_type: "international", year_obtained: 2014, is_active: true, source_url: null, ...PROV };
// Étape 8 (D49, D50) : une entrée d'un programme, dans l'onglet « Admissions ».
const ENTRY = { id: "en-1", programId: "pg-1", entry_year: 1, required_level: 0, route: "PARCOURSUP", note: null, source_url: null, ...PROV, program: { id: "pg-1", name: "PGE" } };

/** Les années distinctes d'une table, ou ses lignes. */
const yearsOr = (rows: unknown[]) => (args: { distinct?: unknown }) => (args?.distinct ? [{ academic_year: 2026 }] : rows);
const school = { findUnique: () => SCHOOL };

interface Case {
  name: string;
  module: string;
  url: string;
  models: FakeModels;
  /** Les objets qui doivent porter `last_edit`. */
  rows: (json: any) => Record<string, unknown>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const CASES: Case[] = [
  {
    name: "l'école (onglet Infos, page des campus)",
    module: "schools/[id]/route",
    url: `/schools/${SCHOOL_ID}`,
    models: { school },
    rows: (json) => [json],
  },
  {
    name: "la gestion d'une école",
    module: "schools/[id]/manage/route",
    url: `/schools/${SCHOOL_ID}/manage`,
    models: {
      school: { findUnique: () => ({ ...SCHOOL, _count: { campuses: 1, programs: 1, accreditations: 1, statsRecords: 1 } }) },
      pricingRecord: { count: () => 1 },
      rankingRecord: { count: () => 1 },
      capacityRecord: { count: () => 1 },
      programEntry: { count: () => 1 },
      schoolStatsRecord: { findMany: () => [{ academic_year: 2026 }] },
    },
    rows: (json) => [json],
  },
  {
    name: "les campus",
    module: "schools/[id]/campuses/route",
    url: `/schools/${SCHOOL_ID}/campuses`,
    models: { school, campus: { findMany: () => [CAMPUS] } },
    rows: (json) => json,
  },
  {
    name: "les programmes",
    module: "schools/[id]/programs/route",
    url: `/schools/${SCHOOL_ID}/programs`,
    models: { school, program: { findMany: () => [PROGRAM] } },
    rows: (json) => json,
  },
  {
    name: "les tarifs",
    module: "schools/[id]/pricing/route",
    url: `/schools/${SCHOOL_ID}/pricing`,
    models: { school, pricingRecord: { findMany: yearsOr([PRICING]) } },
    rows: (json) => json.records,
  },
  {
    name: "les places",
    module: "schools/[id]/capacities/route",
    url: `/schools/${SCHOOL_ID}/capacities`,
    models: { school, capacityRecord: { findMany: yearsOr([CAPACITY]) } },
    rows: (json) => json.records,
  },
  {
    name: "les classements",
    module: "schools/[id]/rankings/route",
    url: `/schools/${SCHOOL_ID}/rankings`,
    models: { school, rankingRecord: { findMany: yearsOr([RANKING]) } },
    rows: (json) => json.records,
  },
  {
    name: "les chiffres clés",
    module: "schools/[id]/stats/route",
    url: `/schools/${SCHOOL_ID}/stats`,
    models: { school, schoolStatsRecord: { findMany: () => [{ academic_year: 2026 }], findUnique: () => STATS } },
    rows: (json) => [json.record],
  },
  {
    name: "les accréditations",
    module: "schools/[id]/accreditations/route",
    url: `/schools/${SCHOOL_ID}/accreditations`,
    models: { school, accreditationRecord: { findMany: () => [ACCREDITATION] } },
    rows: (json) => json,
  },
  {
    name: "les admissions",
    module: "schools/[id]/entries/route",
    url: `/schools/${SCHOOL_ID}/entries`,
    models: { school, programEntry: { findMany: () => [ENTRY] } },
    rows: (json) => json,
  },
];

const handlers = new Map<string, Handler>();

before(async () => {
  for (const c of CASES) {
    const route = (await import(`../../app/api/admin/${c.module}`)) as { GET: Handler };
    handlers.set(c.module, route.GET);
  }
});

beforeEach(() => session.as("GESTIONNAIRE"));

async function call(c: Case, models: FakeModels = c.models): Promise<unknown> {
  db.use(models);
  const res = await handlers.get(c.module)!(get(`http://localhost/api/admin${c.url}`), params({ id: SCHOOL_ID }));
  assert.equal(res.status, 200, c.name);
  assert.deepEqual(schemaErrors(db.calls), [], c.name);
  return res.json();
}

/** Chaque objet de la réponse, à toute profondeur. */
function* objects(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) for (const item of value) yield* objects(item);
  else if (value !== null && typeof value === "object") {
    yield value as Record<string, unknown>;
    for (const child of Object.values(value)) yield* objects(child);
  }
}

for (const c of CASES) {
  test(`${c.name} : « Modifié par … le … », le nom et la date`, async () => {
    const json = await call(c);
    const rows = c.rows(json);
    assert.ok(rows.length > 0, c.name);
    for (const row of rows) assert.equal(row.last_edit, LAST_EDIT, c.name);
  });

  test(`${c.name} : ni l'origine, ni l'identifiant, ni l'adresse de l'auteur`, async () => {
    const json = await call(c);
    for (const object of objects(json)) {
      for (const key of ["updated_via", "updated_by_id", "updatedBy", "updated_by", "email", "username", "password_hash"]) {
        assert.equal(key in object, false, `${c.name} : ${key} dans la réponse`);
      }
    }
    // L'auteur est lu, par son nom affiché seulement.
    const text = JSON.stringify(db.calls.map((call) => call.args));
    const asked = text.match(/"updatedBy":\{"select":\{"display_name":true\}\}/g) ?? [];
    assert.ok(asked.length > 0, `${c.name} : l'auteur n'est pas lu`);
    assert.equal((text.match(/"updatedBy"/g) ?? []).length, asked.length, `${c.name} : l'auteur lu au-delà de son nom`);
  });
}

test("une donnée d'avant le suivi n'a pas de « Modifié par »", async () => {
  const campuses = CASES.find((c) => c.name === "les campus")!;
  const json = (await call(campuses, { school, campus: { findMany: () => [{ ...CAMPUS, ...UNTRACKED }] } })) as Record<string, unknown>[];
  assert.equal(json[0].last_edit, null);
});

test("un auteur sans nom affiché : « Compte sans nom »", async () => {
  const campuses = CASES.find((c) => c.name === "les campus")!;
  const json = (await call(campuses, {
    school,
    campus: { findMany: () => [{ ...CAMPUS, updatedBy: { display_name: null } }] },
  })) as Record<string, unknown>[];
  assert.equal(json[0].last_edit, "Modifié par Compte sans nom le 19 octobre 2026");
});

test("chaque route d'une école qu'appellent les écrans du gestionnaire est couverte", () => {
  // Les onglets de /admin/schools/[id]/manage et la page des campus : un écran
  // qui lirait une nouvelle route de l'école la fait entrer ici.
  const dir = "app/admin/schools/[id]";
  const files = [
    `${dir}/manage/page.tsx`,
    `${dir}/campuses/page.tsx`,
    ...readdirSync(`${dir}/manage/tabs`).map((f) => `${dir}/manage/tabs/${f}`),
  ];
  const called = new Set<string>();
  for (const file of files) {
    for (const [, suffix] of readFileSync(file, "utf8").matchAll(/\/api\/admin\/schools\/\$\{schoolId\}((?:\/[a-z-]+)*)/g)) {
      called.add(`schools/[id]${suffix}`);
    }
  }
  assert.deepEqual(
    CASES.map((c) => c.module.replace(/\/route$/, "")).sort(),
    [...called].sort()
  );
});
