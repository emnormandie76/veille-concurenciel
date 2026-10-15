/**
 * test/api/inbox-attachments.test.ts — PUT /api/admin/inbox/[id]/attachments
 *
 *     npm run test:ts
 *
 * L'écriture des lignes-années `ProgramCampusAttachment` d'un ticket
 * (architecture.md §5.4). Plan backend-local, étape 7 (P0) :
 *
 * - **F2**, comme `validate` : un corps mal formé était avalé par un
 *   `catch {}` muet, et la route écrivait le bloc **brut** du ticket, lignes
 *   que l'admin avait retirées comprises, avec un 200 ;
 * - arête `ProgramCampus` absente → conflit `edge_missing`, aucune ligne
 *   écrite, aucune arête créée.
 *
 * Les règles elles-mêmes (absorption ANY, fusion, plan) sont testées dans
 * test/campus-attachment.test.ts ; ici, la route et ses écritures.
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
  ({ PUT } = await import("../../app/api/admin/inbox/[id]/attachments/route"));
});

beforeEach(() => {
  session.as("MODERATOR");
});

const TICKET_ID = "22222222-3333-4444-5555-666666666666";

const ROW_PGE_CAEN_1 = {
  programId: "program-pge",
  campusId: "campus-caen",
  study_year: 1,
  regime: "INITIAL",
  languages: ["fr"],
  program: "Programme Grande École",
  campus: "Caen",
  fiche: "https://www.em-normandie.com/fr/pge",
};
const ROW_PGE_DUBLIN_2 = {
  ...ROW_PGE_CAEN_1,
  campusId: "campus-dublin",
  campus: "Dublin",
  study_year: 2,
  languages: ["en"],
};

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET_ID,
    status: "Pending_Admin",
    ai_category: "Program_Discovery",
    schoolId: "school-normandie",
    ai_extracted_json: {
      discovered_campuses: [],
      campus_attachments: [ROW_PGE_CAEN_1, ROW_PGE_DUBLIN_2],
    },
    ...overrides,
  };
}

/** Les arêtes qui existent en base, par `programId campusId`. */
const EDGES: Record<string, string> = {
  "program-pge campus-caen": "pc-pge-caen",
  "program-pge campus-dublin": "pc-pge-dublin",
};

function withTicket(row: Record<string, unknown> | null, models: FakeModels = {}): void {
  db.use({
    contributionInbox: {
      findUnique: () => row,
      update: () => ({ id: TICKET_ID }),
    },
    programCampus: {
      findUnique: ({ where }: { where: { programId_campusId: { programId: string; campusId: string } } }) => {
        const { programId, campusId } = where.programId_campusId;
        const id = EDGES[`${programId} ${campusId}`];
        return id ? { id } : null;
      },
    },
    programCampusAttachment: {
      findMany: () => [],
      upsert: () => ({ id: "attachment" }),
    },
    program: {
      findUnique: ({ where }: { where: { id: string } }) => ({
        id: where.id,
        schoolId: where.id === "program-other-school" ? "school-lyon" : "school-normandie",
        campus_policy_note: null,
      }),
      update: () => ({ id: "program" }),
    },
    ...models,
  });
}

function put(body?: string): Promise<Response> {
  return PUT(
    new Request(`http://localhost/api/admin/inbox/${TICKET_ID}/attachments`, {
      method: "PUT",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body,
    }),
    { params: Promise.resolve({ id: TICKET_ID }) }
  );
}

function writtenRows(): Array<{ programCampusId: string; study_year: number }> {
  return db
    .writes()
    .filter((c) => c.model === "programCampusAttachment" && c.method === "upsert")
    .map((c) => (c.args[0] as { create: { programCampusId: string; study_year: number } }).create)
    .map(({ programCampusId, study_year }) => ({ programCampusId, study_year }));
}

function ticketClosed(): boolean {
  return db.writes().some((c) => c.model === "contributionInbox" && c.method === "update");
}

test("sans session : 401, et la base n'est jamais lue", async () => {
  session.as("none");
  db.use({});

  const res = await put("{}");

  assert.equal(res.status, 401);
  assert.deepEqual(db.calls, []);
});

// ── F2 ───────────────────────────────────────────────────────────────

test("F2 : un corps JSON mal formé → 400, rien d'écrit, pas même les lignes du ticket", async () => {
  withTicket(ticket());

  // L'admin a retiré la ligne de Dublin ; son corps arrive tronqué. Avant la
  // correction, la route écrivait les DEUX lignes du ticket et répondait 200.
  const res = await put(`{"campus_attachments": [${JSON.stringify(ROW_PGE_CAEN_1)}`);

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /illisible/i);
  assert.deepEqual(db.writes(), []);
});

for (const [label, body] of [
  ["null", "null"],
  ["un tableau", "[]"],
  ["un nombre", "7"],
] as const) {
  test(`F2 : un corps qui n'est pas un objet JSON (${label}) → 400, rien d'écrit`, async () => {
    withTicket(ticket());

    const res = await put(body);

    assert.equal(res.status, 400);
    assert.deepEqual(db.writes(), []);
  });
}

test("sans corps : les lignes du ticket sont écrites et le ticket clos, dans une transaction", async () => {
  withTicket(ticket());

  const res = await put();

  assert.equal(res.status, 200);
  assert.deepEqual(writtenRows(), [
    { programCampusId: "pc-pge-caen", study_year: 1 },
    { programCampusId: "pc-pge-dublin", study_year: 2 },
  ]);
  assert.ok(ticketClosed());
  assert.ok(db.calls.some((c) => c.model === "$transaction" && c.method === "callback"));
});

test("l'arbitrage de l'admin prime : une ligne retirée n'est pas écrite", async () => {
  withTicket(ticket());

  const res = await put(JSON.stringify({ campus_attachments: [ROW_PGE_CAEN_1] }));

  assert.equal(res.status, 200);
  assert.deepEqual(writtenRows(), [{ programCampusId: "pc-pge-caen", study_year: 1 }]);
});

// ── Arête absente ────────────────────────────────────────────────────

test("arête absente → edge_missing, aucune ligne écrite sur elle, aucune arête créée", async () => {
  const lyonRow = { ...ROW_PGE_CAEN_1, campusId: "campus-lyon", campus: "Lyon" };
  withTicket(ticket({ ai_extracted_json: { campus_attachments: [ROW_PGE_CAEN_1, lyonRow] } }));

  const res = await put();

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(writtenRows(), [{ programCampusId: "pc-pge-caen", study_year: 1 }]);
  const missing = body.conflicts.filter((c: { type: string }) => c.type === "edge_missing");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].campusId, "campus-lyon");
  // Le chemin n'a aucune écriture sur programCampus : ni create, ni upsert.
  assert.deepEqual(
    db.calls.filter((c) => c.model === "programCampus").map((c) => c.method),
    ["findUnique", "findUnique"]
  );
});

// Le ticket n'est clos que si une ligne ou une note a été résolue (écrite ou
// déjà en base). Jusqu'au 14 octobre 2026, il l'était toujours : une fois
// l'arête créée par la validation Program_Discovery, l'admin ne pouvait plus
// rejouer un ticket dont rien n'avait été écrit (constat de l'étape 7, aligné
// sur `validate` avec l'accord du propriétaire).

test("toutes les arêtes absentes : 422 avec les conflits, ticket resté ouvert, rien d'écrit", async () => {
  withTicket(
    ticket({
      ai_extracted_json: {
        campus_attachments: [
          { ...ROW_PGE_CAEN_1, campusId: "campus-lyon", campus: "Lyon" },
          { ...ROW_PGE_DUBLIN_2, programId: "program-msc" },
        ],
      },
    })
  );

  const res = await put();

  assert.equal(res.status, 422);
  const body = await res.json();
  assert.match(body.error, /reste ouvert/);
  // L'écran n'affiche que `error` : le décompte des conflits y figure.
  assert.match(body.error, /2 edge_missing/);
  assert.deepEqual(
    body.conflicts.map((c: { type: string }) => c.type),
    ["edge_missing", "edge_missing"]
  );
  assert.deepEqual(db.writes(), []);
  assert.equal(ticketClosed(), false);
});

test("un bloc vidé par l'admin, sans note : 422, ticket resté ouvert (le rejet reste possible)", async () => {
  withTicket(ticket());

  const res = await put(JSON.stringify({ campus_attachments: [], campus_policy_notes: [] }));

  assert.equal(res.status, 422);
  assert.deepEqual(db.writes(), []);
});

test("des lignes toutes déjà en base, identiques : rien d'écrit, mais le ticket est clos", async () => {
  withTicket(ticket(), {
    programCampusAttachment: {
      findMany: () => [
        { id: "a1", programCampusId: "pc-pge-caen", study_year: 1, regime: "INITIAL",
          languages: ["FR"], note: null, source_url: null },
        { id: "a2", programCampusId: "pc-pge-dublin", study_year: 2, regime: "INITIAL",
          languages: ["EN"], note: null, source_url: null },
      ],
      upsert: () => ({ id: "attachment" }),
    },
  });

  const res = await put();

  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).written, { created: 0, updated: 0, unchanged: 2 });
  assert.deepEqual(writtenRows(), []);
  assert.ok(ticketClosed());
});

test("une seule note résolue suffit à clore le ticket", async () => {
  withTicket(
    ticket({
      ai_extracted_json: {
        campus_attachments: [{ ...ROW_PGE_CAEN_1, campusId: "campus-lyon" }],
        campus_policy_notes: [{ programId: "program-pge", note: "Paris reste accessible chaque année." }],
      },
    })
  );

  const res = await put();

  assert.equal(res.status, 200);
  assert.ok(ticketClosed());
});

// ── Refus ────────────────────────────────────────────────────────────

test("un ticket sans bloc campus_attachments → 400, rien d'écrit", async () => {
  withTicket(ticket({ ai_extracted_json: { discovered_campuses: [] } }));

  const res = await put();

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /validate/);
  assert.deepEqual(db.writes(), []);
});

test("ticket absent : 404 ; déjà validé ou rejeté : 400 ; rien d'écrit", async () => {
  withTicket(null);
  assert.equal((await put()).status, 404);

  for (const status of ["Validated", "Rejected"]) {
    withTicket(ticket({ status }));
    assert.equal((await put()).status, 400, status);
    assert.deepEqual(db.writes(), [], status);
  }
});

test("une note de politique d'un programme d'une autre école n'est pas écrite", async () => {
  withTicket(
    ticket({
      ai_extracted_json: {
        campus_attachments: [],
        campus_policy_notes: [
          { programId: "program-pge", note: "Paris reste accessible chaque année." },
          { programId: "program-other-school", note: "Note d'une autre école." },
        ],
      },
    })
  );

  const res = await put();

  assert.equal(res.status, 200);
  const notes = db
    .writes()
    .filter((c) => c.model === "program" && c.method === "update")
    .map((c) => (c.args[0] as { where: { id: string } }).where.id);
  assert.deepEqual(notes, ["program-pge"]);
  const body = await res.json();
  assert.ok(body.conflicts.some((c: { type: string }) => c.type === "program_outside_school"));
});

test("exception dans la transaction → 500, ticket resté ouvert, rien d'écrit", async () => {
  withTicket(ticket(), {
    programCampusAttachment: {
      findMany: () => [],
      upsert: ({ create }: { create: { study_year: number } }) => {
        if (create.study_year === 2) throw new Error("violation de contrainte interne");
        return { id: "attachment" };
      },
    },
  });

  const original = console.error;
  console.error = () => {};
  let res: Response;
  try {
    res = await put();
  } finally {
    console.error = original;
  }

  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /contrainte interne/);
  assert.equal(ticketClosed(), false);
  assert.deepEqual(db.writes(), []);
});
