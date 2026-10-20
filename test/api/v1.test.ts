/**
 * test/api/v1.test.ts — L'API publique v1 (15 routes)
 *
 *     npm run test:ts
 *
 * Plan backend-local, étape 7 (P1) : forme de la réponse ; 404 ; en-têtes
 * CORS ; format d'erreur d'architecture.md §8.9 (`{ "error": "…" }`) ; bornes
 * de pagination ; une erreur Prisma → 500 au format, sans le message interne.
 *
 * Chaque requête reçue par le faux Prisma est relue contre le vrai schéma
 * (test/helpers/prisma-schema.ts) : c'est ce contrôle qui a révélé
 * `program.campus` dans `/rankings` et `/schools/[id]/pricing` (toujours 500
 * jusqu'au 14 octobre 2026, décision 8 du journal).
 *
 * Plan gestion-contenu, étape 5 : chaque donnée rendue porte la date de sa
 * dernière modification, `updated_at` ; ni l'auteur ni l'origine (D25, revue
 * le 20 octobre). Le détail, route par route : test/api/v1-provenance.test.ts.
 */

import { before, test } from "node:test";
import assert from "node:assert/strict";

import { installFakePrisma, type FakeModels } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";

const db = installFakePrisma();

type Ctx = { params: Promise<{ id: string }> };
type Handler = (request: Request, ctx: Ctx) => Promise<Response>;

const SCHOOL_ID = "11111111-1111-4111-8111-111111111111";
const PROGRAM_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_PROGRAM_ID = "33333333-3333-4333-8333-333333333333";
const CAMPUS_ID = "44444444-4444-4444-8444-444444444444";

// Un message interne qu'aucune réponse ne doit laisser passer.
const INTERNAL = "P1001 postgresql://neondb_owner:motdepasse@ep-interne.neon.tech/neondb";

const SCHOOL = { id: SCHOOL_ID, name: "Em Normandie", official_domain: "em-normandie.com", status: "ACTIVE" };
const CAMPUS = { id: CAMPUS_ID, name: "Caen", city: "Caen" };
const PROGRAM = {
  id: PROGRAM_ID,
  schoolId: SCHOOL_ID,
  name: "Programme Grande École",
  admission_exam: "Passerelle",
  is_alternance_possible: true,
  is_expatriation_mandatory: false,
  min_expatriation_months: null,
  max_internship_months: 12,
};
const PRICING = { id: "pr-1", programId: PROGRAM_ID, academic_year: 2026, currency: "EUR", total_fee: 48000 };
const RANKING = { id: "rk-1", programId: PROGRAM_ID, academic_year: 2026, ranking_name: "Figaro", rank: 9 };
const STATS = { id: "st-1", schoolId: SCHOOL_ID, academic_year: 2026, total_students: 8000 };
const ACCREDITATION = { id: "ac-1", schoolId: SCHOOL_ID, accreditation_name: "EQUIS", is_active: true };

// La date de la dernière modification, telle que la base la rend, puis telle que l'API la rend.
const READ = { updated_at: new Date("2026-10-19T08:30:00Z") };
const SHOWN = { updated_at: "2026-10-19T08:30:00.000Z" };
const row = <T extends object>(data: T) => ({ ...data, ...READ });
const shown = <T extends object>(data: T) => ({ ...data, ...SHOWN });
// Une comparaison lit toujours les trois relations du programme.
// Étape 8 (D53) : les admissions d'un programme, imbriquées dans son détail
// et dans la comparaison.
const ENTRY = { id: "en-1", entry_year: 1, required_level: 2, route: "EXAM", note: "Concours BCE", source_url: null };
const COMPARED = { campuses: [], pricingRecords: [], rankingRecords: [], entries: [] };

const active = { school: { status: "ACTIVE" } };
const inactive = { school: { status: "INACTIVE" } };

interface RouteCase {
  /** Chemin tel qu'API-rest.md le liste. */
  path: string;
  module: string;
  /** Requête du cas nominal (sous /api/v1). */
  url: string;
  id?: string;
  nominal: FakeModels;
  /** Forme attendue du corps du cas nominal. */
  shape: (body: unknown) => void;
  /** Doubles qui doivent donner 404, avec leur libellé. */
  notFound?: [string, FakeModels][];
}

const isPage = (body: unknown) => {
  const { data, pagination } = body as { data: unknown[]; pagination: Record<string, unknown> };
  assert.ok(Array.isArray(data));
  assert.deepEqual(Object.keys(pagination).sort(), ["has_next", "has_prev", "limit", "page", "total", "total_pages"]);
};
const isArrayOf = (expected: unknown) => (body: unknown) => assert.deepEqual(body, [expected]);
const isObject = (expected: unknown) => (body: unknown) => assert.deepEqual(body, expected);

const schoolMissing: [string, FakeModels][] = [
  ["école absente", { school: { findUnique: () => null } }],
  ["école non ACTIVE", { school: { findUnique: () => ({ ...SCHOOL, status: "INACTIVE" }) } }],
];
const programMissing: [string, FakeModels][] = [
  ["programme absent", { program: { findUnique: () => null } }],
  ["école du programme non ACTIVE", { program: { findUnique: () => ({ ...PROGRAM, ...inactive }) } }],
];

const ROUTES: RouteCase[] = [
  {
    path: "/schools",
    module: "../../app/api/v1/schools/route",
    url: "/schools",
    nominal: { school: { findMany: () => [SCHOOL], count: () => 1 } },
    shape: isPage,
  },
  {
    path: "/schools/[id]",
    module: "../../app/api/v1/schools/[id]/route",
    url: `/schools/${SCHOOL_ID}`,
    id: SCHOOL_ID,
    nominal: { school: { findUnique: () => row(SCHOOL) } },
    shape: isObject(shown(SCHOOL)),
    notFound: schoolMissing,
  },
  {
    path: "/schools/[id]/stats",
    module: "../../app/api/v1/schools/[id]/stats/route",
    url: `/schools/${SCHOOL_ID}/stats`,
    id: SCHOOL_ID,
    nominal: { school: { findUnique: () => SCHOOL }, schoolStatsRecord: { findFirst: () => row(STATS) } },
    // Un objet (la dernière année), pas un tableau.
    shape: isObject(shown(STATS)),
    notFound: [
      ...schoolMissing,
      ["aucune statistique", { school: { findUnique: () => SCHOOL }, schoolStatsRecord: { findFirst: () => null } }],
    ],
  },
  {
    path: "/schools/[id]/accreditations",
    module: "../../app/api/v1/schools/[id]/accreditations/route",
    url: `/schools/${SCHOOL_ID}/accreditations`,
    id: SCHOOL_ID,
    nominal: { school: { findUnique: () => SCHOOL }, accreditationRecord: { findMany: () => [row(ACCREDITATION)] } },
    shape: isArrayOf(shown(ACCREDITATION)),
    notFound: schoolMissing,
  },
  {
    path: "/schools/[id]/campuses",
    module: "../../app/api/v1/schools/[id]/campuses/route",
    url: `/schools/${SCHOOL_ID}/campuses`,
    id: SCHOOL_ID,
    nominal: { school: { findUnique: () => SCHOOL }, campus: { findMany: () => [row(CAMPUS)] } },
    shape: isArrayOf(shown(CAMPUS)),
    notFound: schoolMissing,
  },
  {
    path: "/campuses/[id]",
    module: "../../app/api/v1/campuses/[id]/route",
    url: `/campuses/${CAMPUS_ID}`,
    id: CAMPUS_ID,
    nominal: {
      campus: {
        findUnique: () => ({ ...row(CAMPUS), schoolId: SCHOOL_ID, ...active, programCampuses: [{ id: "pc-1", program: PROGRAM }] }),
      },
    },
    // Le statut de l'école sert au contrôle, il ne sort pas.
    shape: isObject({ ...shown(CAMPUS), schoolId: SCHOOL_ID, programCampuses: [{ id: "pc-1", program: PROGRAM }] }),
    notFound: [
      ["campus absent", { campus: { findUnique: () => null } }],
      ["école du campus non ACTIVE", { campus: { findUnique: () => ({ ...CAMPUS, ...inactive, programCampuses: [] }) } }],
    ],
  },
  {
    path: "/schools/[id]/programs",
    module: "../../app/api/v1/schools/[id]/programs/route",
    url: `/schools/${SCHOOL_ID}/programs`,
    id: SCHOOL_ID,
    nominal: { school: { findUnique: () => SCHOOL }, program: { findMany: () => [row(PROGRAM)] } },
    shape: isArrayOf(shown(PROGRAM)),
    notFound: schoolMissing,
  },
  {
    path: "/programs/[id]",
    module: "../../app/api/v1/programs/[id]/route",
    url: `/programs/${PROGRAM_ID}`,
    id: PROGRAM_ID,
    nominal: { program: { findUnique: () => ({ ...row(PROGRAM), school: SCHOOL, campuses: [], entries: [row(ENTRY)] }) } },
    shape: isObject({ ...shown(PROGRAM), school: SCHOOL, campuses: [], entries: [shown(ENTRY)] }),
    notFound: programMissing,
  },
  {
    path: "/programs",
    module: "../../app/api/v1/programs/route",
    url: "/programs",
    nominal: { program: { findMany: () => [PROGRAM], count: () => 1 } },
    shape: isPage,
  },
  {
    path: "/programs/[id]/pricing",
    module: "../../app/api/v1/programs/[id]/pricing/route",
    url: `/programs/${PROGRAM_ID}/pricing`,
    id: PROGRAM_ID,
    nominal: { program: { findUnique: () => active }, pricingRecord: { findMany: () => [row(PRICING)] } },
    shape: isArrayOf(shown(PRICING)),
    notFound: programMissing,
  },
  {
    path: "/schools/[id]/pricing",
    module: "../../app/api/v1/schools/[id]/pricing/route",
    url: `/schools/${SCHOOL_ID}/pricing`,
    id: SCHOOL_ID,
    nominal: { school: { findUnique: () => SCHOOL }, pricingRecord: { findMany: () => [row(PRICING)] } },
    shape: isArrayOf(shown(PRICING)),
    notFound: schoolMissing,
  },
  {
    path: "/programs/[id]/rankings",
    module: "../../app/api/v1/programs/[id]/rankings/route",
    url: `/programs/${PROGRAM_ID}/rankings`,
    id: PROGRAM_ID,
    nominal: { program: { findUnique: () => active }, rankingRecord: { findMany: () => [row(RANKING)] } },
    shape: isArrayOf(shown(RANKING)),
    notFound: programMissing,
  },
  {
    path: "/rankings",
    module: "../../app/api/v1/rankings/route",
    url: "/rankings",
    nominal: { rankingRecord: { findMany: () => [RANKING], count: () => 1 } },
    shape: isPage,
  },
  {
    path: "/programs/[id]/capacity",
    module: "../../app/api/v1/programs/[id]/capacity/route",
    url: `/programs/${PROGRAM_ID}/capacity`,
    id: PROGRAM_ID,
    nominal: {
      program: { findUnique: () => active },
      programCampus: { findMany: () => [{ id: "pc-1", campus: CAMPUS, capacityRecords: [row({ id: "cap-1", academic_year: 2026, spots_available: 120 })] }] },
    },
    shape: isArrayOf({ id: "pc-1", campus: CAMPUS, capacityRecords: [shown({ id: "cap-1", academic_year: 2026, spots_available: 120 })] }),
    notFound: programMissing,
  },
  {
    path: "/compare/programs",
    module: "../../app/api/v1/compare/programs/route",
    url: `/compare/programs?ids=${PROGRAM_ID}`,
    nominal: { program: { findMany: () => [{ ...row(PROGRAM), ...COMPARED }] } },
    shape: isArrayOf({ ...shown(PROGRAM), ...COMPARED }),
    notFound: [["programme absent ou inactif", { program: { findMany: () => [] } }]],
  },
];

const handlers = new Map<string, { GET: Handler; OPTIONS: () => Promise<Response> }>();

before(async () => {
  for (const route of ROUTES) {
    handlers.set(route.path, await import(route.module));
  }
});

async function call(route: RouteCase, url = route.url): Promise<Response> {
  const request = new Request(`http://localhost/api/v1${url}`);
  const ctx: Ctx = { params: Promise.resolve({ id: route.id ?? "" }) };
  return handlers.get(route.path)!.GET(request, ctx);
}

const routeOf = (path: string) => ROUTES.find((r) => r.path === path)!;

function assertCors(res: Response) {
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.equal(res.headers.get("access-control-allow-methods"), "GET, OPTIONS");
}

/** Format d'architecture.md §8.9 : `{ "error": "…" }`, et rien d'autre. */
async function assertError(res: Response, status: number, message?: string | RegExp) {
  assert.equal(res.status, status);
  assertCors(res);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.equal(typeof body.error, "string");
  if (typeof message === "string") assert.equal(body.error, message);
  else if (message) assert.match(body.error, message);
}

function assertSchema() {
  assert.deepEqual(schemaErrors(db.calls), []);
}

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

/** Les mêmes méthodes que `models`, qui lèvent toutes l'erreur interne. */
function failing(models: FakeModels): FakeModels {
  return Object.fromEntries(
    Object.entries(models).map(([model, methods]) => [
      model,
      Object.fromEntries(
        Object.keys(methods).map((method) => [
          method,
          () => {
            throw new Error(INTERNAL);
          },
        ])
      ),
    ])
  );
}

// ── Les 15 routes : cas nominal, OPTIONS, 404, erreur Prisma ──────────

test("l'inventaire couvre les 15 routes d'API-rest.md", () => {
  assert.equal(new Set(ROUTES.map((r) => r.path)).size, 15);
});

for (const route of ROUTES) {
  test(`${route.path} : 200, CORS, forme attendue, requêtes conformes au schéma`, async () => {
    db.use(route.nominal);

    const res = await call(route);

    assert.equal(res.status, 200);
    assertCors(res);
    route.shape(await res.json());
    assertSchema();
    // §8.9 : ces tables ne sortent jamais par l'API publique.
    for (const c of db.calls) {
      assert.ok(!["contributionInbox", "user", "pipelineJob"].includes(c.model), c.model);
      assert.doesNotMatch(JSON.stringify(c.args), /contributions|password_hash|ai_extracted_json/);
    }
  });

  test(`${route.path} : OPTIONS répond avec les en-têtes CORS, sans base`, async () => {
    db.use({});

    const res = await handlers.get(route.path)!.OPTIONS();

    assert.equal(res.status, 200);
    assertCors(res);
    assert.equal(res.headers.get("access-control-allow-headers"), "Content-Type");
    assert.deepEqual(db.calls, []);
  });

  test(`${route.path} : une erreur Prisma → 500 au format, sans le message interne`, async () => {
    db.use(failing(route.nominal));

    const res = await quietly(() => call(route));

    assert.equal(res.status, 500);
    assertCors(res);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { error: "Erreur serveur interne" });
    assert.doesNotMatch(text, /P1001|postgresql|motdepasse|neon/i);
  });

  for (const [label, models] of route.notFound ?? []) {
    test(`${route.path} : ${label} → 404 au format`, async () => {
      db.use(models);

      const res = await call(route);

      await assertError(res, 404, /introuvable/);
      assertSchema();
    });
  }
}

// ── Pagination : /schools, /programs, /rankings ──────────────────────

const PAGED = [
  { path: "/schools", model: "school", defaultLimit: 20 },
  { path: "/programs", model: "program", defaultLimit: 20 },
  { path: "/rankings", model: "rankingRecord", defaultLimit: 50 },
];

for (const { path, model, defaultLimit } of PAGED) {
  const cases: [string, { page: number; limit: number }][] = [
    ["", { page: 1, limit: defaultLimit }],
    ["page=3&limit=10", { page: 3, limit: 10 }],
    ["page=2.9&limit=15", { page: 2, limit: 15 }],
    ["page=0&limit=1000", { page: 1, limit: 100 }],
    ["page=-4&limit=0", { page: 1, limit: 1 }],
    // Décision 9 du journal : une valeur non numérique reprend la valeur par
    // défaut. Avant le 14 octobre 2026 : NaN, refusé par Prisma → 500.
    ["page=abc&limit=xyz", { page: 1, limit: defaultLimit }],
    ["page=&limit=", { page: 1, limit: defaultLimit }],
  ];

  for (const [query, expected] of cases) {
    test(`${path}?${query} : page ${expected.page}, limit ${expected.limit}`, async () => {
      db.use({ [model]: { findMany: () => [], count: () => 0 } });

      const res = await call(routeOf(path), `${path}?${query}`);

      assert.equal(res.status, 200);
      const findMany = db.calls.find((c) => c.method === "findMany")!.args[0] as { skip: number; take: number };
      assert.equal(findMany.take, expected.limit);
      assert.equal(findMany.skip, (expected.page - 1) * expected.limit);
      const { pagination } = await res.json();
      assert.equal(pagination.page, expected.page);
      assert.equal(pagination.limit, expected.limit);
      assertSchema();
    });
  }

  test(`${path} : total_pages, has_next, has_prev`, async () => {
    db.use({ [model]: { findMany: () => [], count: () => 45 } });

    const res = await call(routeOf(path), `${path}?page=2&limit=20`);

    assert.deepEqual((await res.json()).pagination, {
      page: 2,
      limit: 20,
      total: 45,
      total_pages: 3,
      has_next: true,
      has_prev: true,
    });
  });
}

// ── Paramètre year : 400 au format, avant la lecture des données ─────

const WITH_YEAR = [
  ["/schools/[id]/stats", "schoolStatsRecord"],
  ["/schools/[id]/pricing", "pricingRecord"],
  ["/programs/[id]/pricing", "pricingRecord"],
  ["/programs/[id]/rankings", "rankingRecord"],
  ["/programs/[id]/capacity", "programCampus"],
  ["/rankings", "rankingRecord"],
] as const;

for (const [path, dataModel] of WITH_YEAR) {
  test(`${path}?year=abc → 400 « Année invalide », données non lues`, async () => {
    const route = routeOf(path);
    db.use(route.nominal);

    const res = await call(route, `${route.url}?year=abc`);

    await assertError(res, 400, "Année invalide");
    assert.ok(!db.calls.some((c) => c.model === dataModel), path);
  });
}

// ── Filtres propres à chaque route ───────────────────────────────────

function argsOf(model: string, method = "findMany") {
  return db.calls.find((c) => c.model === model && c.method === method)!.args[0] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

test("/schools : écoles ACTIVE seulement ; search filtre le nom sans casse", async () => {
  db.use(routeOf("/schools").nominal);
  await call(routeOf("/schools"), "/schools?search=normandie");
  assert.deepEqual(argsOf("school").where, {
    status: "ACTIVE",
    name: { contains: "normandie", mode: "insensitive" },
  });
  assert.deepEqual(argsOf("school", "count").where, argsOf("school").where);
});

test("/programs : école ACTIVE ; alternance, concours, recherche nom ou école", async () => {
  const route = routeOf("/programs");
  db.use(route.nominal);
  await call(route, "/programs?alternance=false&admission_exam=sesame&search=pge");
  const where = argsOf("program").where;
  assert.deepEqual(where.school, { status: "ACTIVE" });
  assert.equal(where.is_alternance_possible, false);
  assert.deepEqual(where.admission_exam, { contains: "sesame", mode: "insensitive" });
  assert.deepEqual(where.OR, [
    { name: { contains: "pge", mode: "insensitive" } },
    { school: { name: { contains: "pge", mode: "insensitive" } } },
  ]);
  assertSchema();

  db.use(route.nominal);
  await call(route, "/programs");
  assert.deepEqual(argsOf("program").where, { school: { status: "ACTIVE" } });
});

test("/rankings : écoles ACTIVE seulement (par program.school), filtres nom et année", async () => {
  const route = routeOf("/rankings");
  db.use(route.nominal);
  await call(route, "/rankings?ranking_name=figaro&year=2026");
  assert.deepEqual(argsOf("rankingRecord").where, {
    program: { school: { status: "ACTIVE" } },
    ranking_name: { contains: "figaro", mode: "insensitive" },
    academic_year: 2026,
  });
  // Chaque classement nomme l'école et les campus du programme.
  const program = argsOf("rankingRecord").select.program.select;
  assert.ok(program.school && program.campuses, "program.school et program.campuses sélectionnés");
  assertSchema();
});

test("/schools/[id]/pricing : les tarifs des programmes de l'école, filtre année", async () => {
  const route = routeOf("/schools/[id]/pricing");
  db.use(route.nominal);
  await call(route, `${route.url}?year=2026`);
  assert.deepEqual(argsOf("pricingRecord").where, { program: { schoolId: SCHOOL_ID }, academic_year: 2026 });
  assert.ok(argsOf("pricingRecord").select.program.select.campuses, "program.campuses sélectionné");
  assert.equal(argsOf("pricingRecord").take, 500);
  assertSchema();
});

test("/schools/[id]/stats : year → l'année demandée par la clé composée ; sinon la plus récente", async () => {
  const route = routeOf("/schools/[id]/stats");
  db.use({ school: { findUnique: () => SCHOOL }, schoolStatsRecord: { findUnique: () => STATS } });
  const res = await call(route, `${route.url}?year=2026`);
  assert.equal(res.status, 200);
  assert.deepEqual(argsOf("schoolStatsRecord", "findUnique").where, {
    schoolId_academic_year: { schoolId: SCHOOL_ID, academic_year: 2026 },
  });
  assertSchema();

  db.use(route.nominal);
  await call(route);
  assert.deepEqual(argsOf("schoolStatsRecord", "findFirst").orderBy, { academic_year: "desc" });
});

test("/schools/[id]/accreditations : accréditations actives seulement", async () => {
  const route = routeOf("/schools/[id]/accreditations");
  db.use(route.nominal);
  await call(route);
  assert.deepEqual(argsOf("accreditationRecord").where, { schoolId: SCHOOL_ID, is_active: true });
});

test("/schools/[id]/programs : campus_id passe par ProgramCampus", async () => {
  const route = routeOf("/schools/[id]/programs");
  db.use(route.nominal);
  await call(route, `${route.url}?campus_id=${CAMPUS_ID}`);
  assert.deepEqual(argsOf("program").where, { schoolId: SCHOOL_ID, campuses: { some: { campusId: CAMPUS_ID } } });
  assertSchema();
});

test("/programs/[id]/rankings : filtres année et nom", async () => {
  const route = routeOf("/programs/[id]/rankings");
  db.use(route.nominal);
  await call(route, `${route.url}?year=2025&ranking_name=Figaro`);
  assert.deepEqual(argsOf("rankingRecord").where, {
    programId: PROGRAM_ID,
    academic_year: 2025,
    ranking_name: { contains: "Figaro", mode: "insensitive" },
  });
});

test("/programs/[id]/capacity : capacités par campus, filtre année", async () => {
  const route = routeOf("/programs/[id]/capacity");
  db.use(route.nominal);
  await call(route, `${route.url}?year=2025`);
  const args = argsOf("programCampus");
  assert.deepEqual(args.where, { programId: PROGRAM_ID });
  assert.deepEqual(args.select.capacityRecords.where, { academic_year: 2025 });
  assertSchema();
});

test("/programs/[id] et /compare/programs : les admissions, par année d'entrée puis niveau, sans auteur (D53)", async () => {
  for (const path of ["/programs/[id]", "/compare/programs"]) {
    const route = routeOf(path);
    db.use(route.nominal);
    await call(route);
    const call0 = db.calls.find((c) => c.model === "program")!;
    const entries = (call0.args[0] as { select: { entries: { select: Record<string, true>; orderBy: unknown } } }).select.entries;
    assert.deepEqual(Object.keys(entries.select).sort(), ["entry_year", "id", "note", "required_level", "route", "source_url", "updated_at"], path);
    assert.deepEqual(entries.orderBy, [{ entry_year: "asc" }, { required_level: "asc" }, { route: "asc" }], path);
    assertSchema();
  }
});

// ── Comparaison ──────────────────────────────────────────────────────

test("/compare/programs : ids manquant, vide ou plus de 5 → 400, sans base", async () => {
  const route = routeOf("/compare/programs");
  const six = Array.from({ length: 6 }, (_, i) => `p-${i}`).join(",");
  for (const [query, message] of [
    ["", /ids manquant/],
    ["?ids=", /ids manquant/],
    ["?ids=,%20,", /Aucun identifiant/],
    [`?ids=${six}`, /Maximum 5/],
  ] as const) {
    db.use(route.nominal);
    await assertError(await call(route, `/compare/programs${query}`), 400, message);
    assert.deepEqual(db.calls, [], query);
  }
});

test("/compare/programs : identifiants dédupliqués, ordre de la requête conservé", async () => {
  const route = routeOf("/compare/programs");
  const other = { ...PROGRAM, id: OTHER_PROGRAM_ID, name: "MSc", ...COMPARED };
  db.use({ program: { findMany: () => [{ ...PROGRAM, ...COMPARED }, other] } });

  const res = await call(route, `/compare/programs?ids=${OTHER_PROGRAM_ID},${PROGRAM_ID},${OTHER_PROGRAM_ID}`);

  assert.equal(res.status, 200);
  assert.deepEqual(
    (await res.json()).map((p: { id: string }) => p.id),
    [OTHER_PROGRAM_ID, PROGRAM_ID]
  );
  assert.deepEqual(argsOf("program").where, {
    id: { in: [OTHER_PROGRAM_ID, PROGRAM_ID] },
    school: { status: "ACTIVE" },
  });
});

test("/compare/programs : un programme sur deux introuvable ou inactif → 404", async () => {
  const route = routeOf("/compare/programs");
  db.use({ program: { findMany: () => [PROGRAM] } });

  const res = await call(route, `/compare/programs?ids=${PROGRAM_ID},${OTHER_PROGRAM_ID}`);

  await assertError(res, 404, /introuvables ou inactifs/);
});
