/**
 * test/api/inbox-validate.test.ts — PUT /api/admin/inbox/[id]/validate
 *
 *     npm run test:ts
 *
 * La porte d'entrée de la production : un ticket validé écrit dans les tables
 * publiques. Plan backend-local, étape 7 (P0) :
 *
 * - **F2** : un corps JSON mal formé était avalé par un `catch {}` muet, et la
 *   route écrivait le JSON **brut de l'IA** à la place des corrections de
 *   l'admin, avec un 200. Il doit répondre 400 sans rien écrire. Un corps
 *   absent ou vide (`{}`) reste la façon de dire « validez tel quel ».
 * - les charges refusées : bloc `campus_attachments` (route voisine) et
 *   rapport Research rangé ;
 * - multi-programme : le ticket n'est clos que si une donnée est écrite,
 *   sinon 422 avec `skipped` ;
 * - capacité : les quatre cas de résolution du campus (architecture.md §6.2) ;
 * - une exception dans la transaction laisse le ticket `Pending_Admin`.
 *
 * Le faux Prisma n'a pas de rollback réel : `db.writes()` rend les écritures
 * qu'une base aurait gardées (test/helpers/fake-prisma.ts).
 */

import { afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { installFakePrisma, type FakeModels } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";
import { installSession } from "../helpers/session";

const db = installFakePrisma();

// Chaque requête reçue par le faux doit exister dans le vrai schéma Prisma
// (test/helpers/prisma-schema.ts).
afterEach(() => {
  assert.deepEqual(schemaErrors(db.calls), []);
});
const session = installSession();

type Handler = (
  request: Request,
  context: { params: Promise<{ id: string }> }
) => Promise<Response>;

let PUT: Handler;

before(async () => {
  ({ PUT } = await import("../../app/api/admin/inbox/[id]/validate/route"));
});

beforeEach(() => {
  session.as("MODERATOR");
});

const TICKET_ID = "11111111-2222-3333-4444-555555555555";

/** Ce que l'IA a extrait : c'est ce que F2 écrivait à la place des corrections. */
const AI_PRICING = {
  academic_year: 2026,
  currency: "EUR",
  year_1_fee: 14500,
  total_fee: 43500,
  source_url: "https://www.em-normandie.com/fr/tarifs",
};

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET_ID,
    status: "Pending_Admin",
    source_type: "Automated_AI",
    ai_category: "Pricing",
    schoolId: "school-1",
    programId: "program-1",
    campusId: null,
    programCampusId: null,
    ai_extracted_json: AI_PRICING,
    year_assumed: false,
    data_conflict_warning: false,
    ...overrides,
  };
}

/** Le ticket rendu par la base, plus les méthodes propres au test. */
function withTicket(row: Record<string, unknown>, models: FakeModels = {}): void {
  db.use({
    ...models,
    contributionInbox: {
      findUnique: () => row,
      update: ({ where, data }: { where: { id: string }; data: unknown }) => ({
        id: where.id,
        ...(data as object),
      }),
      ...(models.contributionInbox ?? {}),
    },
  });
}

function put(body?: string): Promise<Response> {
  return PUT(
    new Request(`http://localhost/api/admin/inbox/${TICKET_ID}/validate`, {
      method: "PUT",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body,
    }),
    { params: Promise.resolve({ id: TICKET_ID }) }
  );
}

/** Coupe le journal d'erreurs attendu d'un 500, et le rend. */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

const PRICING_STORE = {
  pricingRecord: {
    upsert: ({ create }: { create: Record<string, unknown> }) => ({ id: "pricing-1", ...create }),
  },
};

function upsertsOf(model: string) {
  return db
    .writes()
    .filter((c) => c.model === model && c.method === "upsert")
    .map((c) => c.args[0] as { create: Record<string, unknown>; update: Record<string, unknown> });
}

function ticketClosed(): boolean {
  return db
    .writes()
    .some(
      (c) =>
        c.model === "contributionInbox" &&
        c.method === "update" &&
        (c.args[0] as { data: { status?: string } }).data.status === "Validated"
    );
}

// ── Garde ────────────────────────────────────────────────────────────

test("sans session : 401, et la base n'est jamais lue", async () => {
  session.as("none");
  db.use({});

  const res = await put(JSON.stringify({ academic_year: 2026 }));

  assert.equal(res.status, 401);
  assert.deepEqual(db.calls, []);
});

// ── F2 : le corps de l'admin, lu ou refusé, jamais remplacé en silence ──

test("F2 : un corps JSON mal formé → 400, rien d'écrit, et pas le JSON de l'IA à la place", async () => {
  withTicket(ticket(), PRICING_STORE);

  // Le formulaire de l'admin, tronqué en route : sa correction de total_fee
  // n'arrive pas. Avant la correction, la route écrivait AI_PRICING et
  // répondait 200.
  const res = await put('{"academic_year": 2026, "total_fee": 39000');

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /illisible/i);
  assert.deepEqual(db.writes(), []);
});

for (const [label, body] of [
  ["null", "null"],
  ["un tableau", "[]"],
  ["un nombre", "42"],
  ["une chaîne", '"total_fee: 39000"'],
] as const) {
  test(`F2 : un corps qui n'est pas un objet JSON (${label}) → 400, rien d'écrit`, async () => {
    withTicket(ticket(), PRICING_STORE);

    const res = await put(body);

    assert.equal(res.status, 400);
    assert.deepEqual(db.writes(), []);
  });
}

test("sans corps : les données du ticket sont écrites, avec la clôture dans la même transaction", async () => {
  withTicket(ticket(), PRICING_STORE);

  const res = await put();

  assert.equal(res.status, 200);
  const [upsert] = upsertsOf("pricingRecord");
  assert.equal(upsert.create.total_fee, 43500);
  assert.equal(upsert.create.year_1_fee, 14500);
  assert.equal(upsert.create.programId, "program-1");
  assert.ok(ticketClosed());
  assert.ok(db.calls.some((c) => c.model === "$transaction" && c.method === "array"));
});

test("un corps vide ({}) vaut « validez tel quel » : les données du ticket", async () => {
  withTicket(ticket(), PRICING_STORE);

  const res = await put("{}");

  assert.equal(res.status, 200);
  assert.equal(upsertsOf("pricingRecord")[0].create.total_fee, 43500);
});

test("la correction de l'admin prime sur l'extraction de l'IA", async () => {
  withTicket(ticket(), PRICING_STORE);

  const res = await put(JSON.stringify({ ...AI_PRICING, total_fee: 39000 }));

  assert.equal(res.status, 200);
  const [upsert] = upsertsOf("pricingRecord");
  assert.equal(upsert.create.total_fee, 39000);
  assert.equal(upsert.update.total_fee, 39000);
});

// ── Charges refusées ────────────────────────────────────────────────

test("un ticket qui porte campus_attachments est refusé, même avec un corps, et rien n'est écrit", async () => {
  withTicket(
    ticket({
      ai_category: "Program_Discovery",
      programId: null,
      ai_extracted_json: { discovered_campuses: [], campus_attachments: [{ programId: "p", campusId: "c" }] },
    })
  );

  // Ce qu'enverrait le formulaire répéteur, qui ne voit pas le bloc.
  const res = await put(JSON.stringify({ discovered_campuses: [] }));

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /attachments/);
  assert.deepEqual(db.writes(), []);
});

test("un rapport Research rangé ne se valide pas, et rien n'est écrit", async () => {
  withTicket(
    ticket({
      ai_category: "Program_Discovery",
      status: "Failed",
      programId: null,
      ai_extracted_json: { parked_reason: "research_report_parked" },
    })
  );

  const res = await put(JSON.stringify({ discovered_campuses: [] }));

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /rapport Research/);
  assert.deepEqual(db.writes(), []);
});

test("un ticket déjà validé ou rejeté n'est pas revalidé", async () => {
  for (const status of ["Validated", "Rejected"]) {
    withTicket(ticket({ status }), PRICING_STORE);

    const res = await put();

    assert.equal(res.status, 400, status);
    assert.deepEqual(db.writes(), [], status);
  }
});

test("ticket absent : 404, rien d'écrit", async () => {
  db.use({ contributionInbox: { findUnique: () => null } });

  const res = await put();

  assert.equal(res.status, 404);
  assert.deepEqual(db.writes(), []);
});

// ── Multi-programme : clos seulement si une donnée est écrite ─────────

function multiProgram(category: string, programs: unknown[]) {
  return ticket({ ai_category: category, programId: null, ai_extracted_json: { programs } });
}

test("multi-programme : toutes les entrées écartées → 422 avec skipped, ticket resté ouvert", async () => {
  withTicket(
    multiProgram("Pricing", [
      {
        extracted_program_name: "PGE",
        matched_program_id: "program-1",
        matched_program_name: "Programme Grande École",
        match_confidence: "exact",
        data: { total_fee: 43500 }, // academic_year absent
      },
    ]),
    PRICING_STORE
  );

  const res = await put();

  assert.equal(res.status, 422);
  const body = await res.json();
  assert.deepEqual(body.skipped, [
    { program: "Programme Grande École", reason: "academic_year absent" },
  ]);
  assert.equal(ticketClosed(), false);
  assert.deepEqual(upsertsOf("pricingRecord"), []);
});

test("multi-programme : un succès partiel clôt le ticket et nomme l'entrée écartée", async () => {
  withTicket(
    multiProgram("Pricing", [
      {
        extracted_program_name: "PGE",
        matched_program_id: "program-1",
        matched_program_name: "PGE",
        match_confidence: "exact",
        data: { academic_year: 2026, total_fee: 43500 },
      },
      {
        extracted_program_name: "MSc",
        matched_program_id: "program-2",
        matched_program_name: "MSc",
        match_confidence: "fuzzy",
        data: { total_fee: 21000 },
      },
    ]),
    PRICING_STORE
  );

  const res = await put();

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.count, 1);
  assert.deepEqual(body.skipped, [{ program: "MSc", reason: "academic_year absent" }]);
  assert.ok(ticketClosed());
});

test("multi-programme : aucun programme rattaché à un id → 400, rien d'écrit", async () => {
  withTicket(
    multiProgram("Pricing", [
      {
        extracted_program_name: "Inconnu",
        matched_program_id: null,
        matched_program_name: null,
        match_confidence: "none",
        data: { academic_year: 2026 },
      },
    ])
  );

  const res = await put();

  assert.equal(res.status, 400);
  assert.deepEqual(db.writes(), []);
});

// ── Capacité : les quatre cas de résolution du campus (§6.2) ──────────

const ASSOCIATIONS = {
  single: [{ id: "pc-caen", campusId: "campus-caen", campus: { name: "Caen" } }],
  several: [
    { id: "pc-caen", campusId: "campus-caen", campus: { name: "Caen" } },
    { id: "pc-paris", campusId: "campus-paris", campus: { name: "Paris" } },
  ],
  twins: [
    { id: "pc-paris-1", campusId: "campus-paris-1", campus: { name: "Paris" } },
    { id: "pc-paris-2", campusId: "campus-paris-2", campus: { name: " paris " } },
  ],
};

async function validateCapacity(
  data: Record<string, unknown>,
  associations: unknown[]
): Promise<{ status: number; body: { skipped?: unknown[] }; written: string[] }> {
  withTicket(
    multiProgram("Capacity", [
      {
        extracted_program_name: "Bachelor",
        matched_program_id: "program-1",
        matched_program_name: "Bachelor",
        match_confidence: "exact",
        data: { academic_year: 2026, spots_available: 120, ...data },
      },
    ]),
    {
      programCampus: { findMany: () => associations },
      capacityRecord: {
        upsert: ({ create }: { create: Record<string, unknown> }) => ({ id: "cap-1", ...create }),
      },
    }
  );
  const res = await put();
  return {
    status: res.status,
    body: await res.json(),
    written: upsertsOf("capacityRecord").map((u) => u.create.programCampusId as string),
  };
}

test("capacité, cas 1 : campus_id fourni et rattaché → écrit sur ce campus", async () => {
  const { status, written } = await validateCapacity({ campus_id: "campus-paris" }, ASSOCIATIONS.several);

  assert.equal(status, 200);
  assert.deepEqual(written, ["pc-paris"]);
  assert.ok(ticketClosed());
});

test("capacité, cas 1 bis : campus_id fourni mais non rattaché → écarté, 422", async () => {
  const { status, body, written } = await validateCapacity({ campus_id: "campus-lyon" }, ASSOCIATIONS.several);

  assert.equal(status, 422);
  assert.deepEqual(written, []);
  assert.match(JSON.stringify(body.skipped), /campus-lyon non rattaché/);
  assert.equal(ticketClosed(), false);
});

test("capacité, cas 2 : campus_name fourni → correspondance exacte, insensible à la casse et aux espaces", async () => {
  const { status, written } = await validateCapacity({ campus_name: "  PARIS " }, ASSOCIATIONS.several);

  assert.equal(status, 200);
  assert.deepEqual(written, ["pc-paris"]);
});

test("capacité, cas 2 bis : campus_name introuvable ou ambigu → écarté", async () => {
  const unknown = await validateCapacity({ campus_name: "Dublin" }, ASSOCIATIONS.several);
  assert.equal(unknown.status, 422);
  assert.deepEqual(unknown.written, []);

  const ambiguous = await validateCapacity({ campus_name: "Paris" }, ASSOCIATIONS.twins);
  assert.equal(ambiguous.status, 422);
  assert.deepEqual(ambiguous.written, []);
  assert.match(JSON.stringify(ambiguous.body.skipped), /introuvable ou ambigu/);
});

test("capacité, cas 3 : une seule association, campus non précisé → écrit sur elle", async () => {
  const { status, written } = await validateCapacity({}, ASSOCIATIONS.single);

  assert.equal(status, 200);
  assert.deepEqual(written, ["pc-caen"]);
});

test("capacité, cas 4 : plusieurs associations sans campus précisé → écarté, jamais écrit au hasard", async () => {
  const { status, body, written } = await validateCapacity({}, ASSOCIATIONS.several);

  assert.equal(status, 422);
  assert.deepEqual(written, []);
  assert.match(JSON.stringify(body.skipped), /ouvert sur 2 campus et campus non précisé/);
  assert.equal(ticketClosed(), false);
});

test("capacité : un programme sans aucun campus rattaché → écarté", async () => {
  const { status, written } = await validateCapacity({}, []);

  assert.equal(status, 422);
  assert.deepEqual(written, []);
});

test("capacité : 0 place est une donnée, pas une absence", async () => {
  const { status, written } = await validateCapacity({ spots_available: 0 }, ASSOCIATIONS.single);

  assert.equal(status, 200);
  assert.deepEqual(written, ["pc-caen"]);
});

// ── Accréditations d'une contribution : un ticket, une liste (C1) ───────

/** Ce que le crowdsourcing écrit pour une page qui cite EQUIS, AACSB et AMBA. */
const CONTRIBUTED_ACCREDITATIONS = {
  accreditations: ["EQUIS", "AACSB", "AMBA"].map((name) => ({
    accreditation_name: name,
    accreditation_type: "international",
    year_obtained: null,
    is_active: true,
    source_url: "https://em-lyon.com/en/about-emlyon-business-school/institution",
  })),
  ignored_urls: ["https://em-lyon.com/sixieme-url"],
};

const ACCREDITATION_STORE = {
  accreditationRecord: {
    upsert: ({ create }: { create: Record<string, unknown> }) => ({ id: "acc-1", ...create }),
  },
};

test("une contribution à trois accréditations : un ticket, trois enregistrements, une seule clôture", async () => {
  withTicket(
    ticket({
      source_type: "User_Submission",
      ai_category: "Accreditation",
      programId: null,
      ai_extracted_json: CONTRIBUTED_ACCREDITATIONS,
    }),
    ACCREDITATION_STORE,
  );

  const res = await put();

  assert.equal(res.status, 200);
  assert.equal((await res.json()).count, 3);
  const upserts = upsertsOf("accreditationRecord");
  assert.deepEqual(
    upserts.map((u) => u.create.accreditation_name),
    ["EQUIS", "AACSB", "AMBA"],
  );
  assert.ok(upserts.every((u) => u.create.schoolId === "school-1" && u.create.year_obtained === null));
  // `ignored_urls` accompagne la liste dans le ticket : il ne devient pas une accréditation.
  assert.ok(upserts.every((u) => !("ignored_urls" in u.create)));
  const closures = db
    .writes()
    .filter((c) => c.model === "contributionInbox" && c.method === "update");
  assert.equal(closures.length, 1);
  assert.ok(ticketClosed());
});

test("accréditations : la correction de l'admin (liste réduite) prime sur celle de l'IA", async () => {
  withTicket(
    ticket({
      source_type: "User_Submission",
      ai_category: "Accreditation",
      programId: null,
      ai_extracted_json: CONTRIBUTED_ACCREDITATIONS,
    }),
    ACCREDITATION_STORE,
  );

  const res = await put(JSON.stringify({ accreditations: CONTRIBUTED_ACCREDITATIONS.accreditations.slice(0, 2) }));

  assert.equal(res.status, 200);
  assert.deepEqual(
    upsertsOf("accreditationRecord").map((u) => u.create.accreditation_name),
    ["EQUIS", "AACSB"],
  );
});

// ── Une exception dans la transaction : le ticket reste Pending_Admin ──

test("exception dans la transaction (forme tableau) → 500, ticket resté ouvert, rien d'écrit", async () => {
  withTicket(ticket(), {
    pricingRecord: {
      upsert: () => {
        throw new Error("P2002: Unique constraint failed on secret_internal_index");
      },
    },
  });

  const res = await quietly(() => put());

  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /P2002|secret_internal_index/);
  // Le faux a bien reçu la clôture du ticket (il exécute la forme tableau
  // dès sa construction) : c'est le rollback qui la retire.
  assert.ok(db.calls.some((c) => c.model === "contributionInbox" && c.method === "update"));
  assert.equal(ticketClosed(), false);
  assert.deepEqual(db.writes(), []);
});

test("exception dans la transaction (Program_Discovery) → 500, ticket resté ouvert, rien d'écrit", async () => {
  withTicket(
    ticket({
      ai_category: "Program_Discovery",
      programId: null,
      ai_extracted_json: {
        discovered_campuses: [
          { name: "Caen", city: "Caen", programs: [{ name: "PGE" }, { name: "Bachelor" }] },
        ],
      },
    }),
    {
      campus: { upsert: () => ({ id: "campus-caen", name: "Caen" }) },
      program: {
        upsert: ({ create }: { create: { name: string } }) => {
          if (create.name === "Bachelor") throw new Error("connexion perdue");
          return { id: "program-pge" };
        },
      },
      programCampus: { upsert: () => ({ id: "pc-1" }) },
    }
  );

  const res = await quietly(() => put());

  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /Rollback/);
  assert.equal(ticketClosed(), false);
  assert.deepEqual(db.writes(), []);
});

test("exception dans la transaction (multi-programme) → 500, ticket resté ouvert, rien d'écrit", async () => {
  withTicket(
    multiProgram("Capacity", [
      {
        extracted_program_name: "Bachelor",
        matched_program_id: "program-1",
        matched_program_name: "Bachelor",
        match_confidence: "exact",
        data: { academic_year: 2026, spots_available: 120 },
      },
    ]),
    {
      programCampus: { findMany: () => ASSOCIATIONS.single },
      capacityRecord: {
        upsert: () => {
          throw new Error("délai de 60 s dépassé");
        },
      },
    }
  );

  const res = await quietly(() => put());

  assert.equal(res.status, 500);
  assert.equal(ticketClosed(), false);
  assert.deepEqual(db.writes(), []);
});

// ── Program_Discovery : le cas nominal ──────────────────────────────

test("Program_Discovery : un même programme sur deux campus = un Program et deux arêtes", async () => {
  const programIds = new Map<string, string>();
  withTicket(
    ticket({
      ai_category: "Program_Discovery",
      programId: null,
      ai_extracted_json: {
        discovered_campuses: [
          { name: "Caen", city: "Caen", programs: [{ name: "PGE" }] },
          { name: "Paris", city: "Paris", programs: [{ name: "PGE" }, { name: "" }] },
        ],
      },
    }),
    {
      campus: {
        upsert: ({ create }: { create: { name: string } }) => ({ id: `campus-${create.name}`, name: create.name }),
      },
      program: {
        upsert: ({ create }: { create: { name: string } }) => {
          if (!programIds.has(create.name)) programIds.set(create.name, `program-${programIds.size + 1}`);
          return { id: programIds.get(create.name) };
        },
      },
      programCampus: { upsert: () => ({}) },
    }
  );

  const res = await put();

  assert.equal(res.status, 200);
  const edges = upsertsOf("programCampus").map(
    (u) => (u as unknown as { where: { programId_campusId: unknown } }).where.programId_campusId
  );
  assert.deepEqual(edges, [
    { programId: "program-1", campusId: "campus-Caen" },
    { programId: "program-1", campusId: "campus-Paris" },
  ]);
  assert.ok(ticketClosed());
});
