/**
 * test/api/inbox-actions.test.ts — purge, rejet, création de programmes
 *
 *     npm run test:ts
 *
 * Plan backend-local, étape 7 (P1) :
 * - DELETE /api/admin/inbox/purge : ne supprime jamais `Pending_AI` ni
 *   `Pending_Admin` (ni `Failed`) ; ADMIN seulement ;
 * - PUT /api/admin/inbox/[id]/reject : ticket absent → 404 ;
 * - POST /api/admin/inbox/[id]/create-programs : ticket absent → 404 ; les
 *   programmes sont créés pour la seule école du ticket.
 */

import { afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { contentOf, installContentCache } from "../helpers/provenance";
import { installFakePrisma } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";
import { installSession } from "../helpers/session";

const db = installFakePrisma();
// Étape 5 : les écritures revalident les fiches (lib/content-cache.ts).
installContentCache();

// Chaque requête reçue par le faux doit exister dans le vrai schéma Prisma
// (test/helpers/prisma-schema.ts).
afterEach(() => {
  assert.deepEqual(schemaErrors(db.calls), []);
});
const session = installSession();

type Ctx = { params: Promise<{ id: string }> };
let purge: (request: Request) => Promise<Response>;
let reject: (request: Request, ctx: Ctx) => Promise<Response>;
let createPrograms: (request: Request, ctx: Ctx) => Promise<Response>;

before(async () => {
  ({ DELETE: purge } = await import("../../app/api/admin/inbox/purge/route"));
  ({ PUT: reject } = await import("../../app/api/admin/inbox/[id]/reject/route"));
  ({ POST: createPrograms } = await import("../../app/api/admin/inbox/[id]/create-programs/route"));
});

beforeEach(() => {
  session.as("ADMIN");
});

const TICKET_ID = "33333333-4444-5555-6666-777777777777";
const ctx = (): Ctx => ({ params: Promise.resolve({ id: TICKET_ID }) });
const json = (body: unknown, method = "POST") =>
  new Request("http://localhost/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

// ── Purge ────────────────────────────────────────────────────────────

test("purge : ADMIN seulement — sans session 401, USER et GESTIONNAIRE 403, rien de supprimé", async () => {
  db.use({});

  session.as("none");
  assert.equal((await purge(json({ statuses: ["Validated"] }, "DELETE"))).status, 401);
  for (const profile of ["USER", "GESTIONNAIRE"] as const) {
    session.as(profile);
    assert.equal((await purge(json({ statuses: ["Validated"] }, "DELETE"))).status, 403, profile);
  }
  assert.deepEqual(db.calls, []);
});

test("rejet et création de programmes : l'inbox est réservée à l'admin, un GESTIONNAIRE reçoit 403, rien de lu", async () => {
  session.as("GESTIONNAIRE");
  db.use({});

  assert.equal((await reject(json({}, "PUT"), ctx())).status, 403);
  assert.equal((await createPrograms(json({ programNames: ["MBA"] }), ctx())).status, 403);
  assert.deepEqual(db.calls, []);
});

test("purge : ne supprime jamais Pending_AI, Pending_Admin ni Failed", async () => {
  for (const statuses of [["Pending_AI"], ["Pending_Admin"], ["Failed"], ["Validated", "Pending_Admin"], ["inventé"]]) {
    db.use({ contributionInbox: { deleteMany: () => ({ count: 99 }) } });

    const res = await purge(json({ statuses }, "DELETE"));

    assert.equal(res.status, 400, statuses.join());
    assert.deepEqual(db.writes(), [], statuses.join());
  }
});

test("purge : corps sans statuts → 400", async () => {
  for (const body of [{}, { statuses: [] }, { statuses: "Validated" }]) {
    db.use({ contributionInbox: { deleteMany: () => ({ count: 0 }) } });
    assert.equal((await purge(json(body, "DELETE"))).status, 400);
    assert.deepEqual(db.writes(), []);
  }
});

test("D120 : purge, un JSON mal formé, ou qui n'est pas un objet → 400, rien de supprimé", async () => {
  for (const raw of ["{pas du json", "[]", "null", "42"]) {
    db.use({ contributionInbox: { deleteMany: () => ({ count: 0 }) } });
    const res = await quietly(() => purge(json(raw, "DELETE")));
    assert.equal(res.status, 400, raw);
    assert.deepEqual(await res.json(), { error: "Corps de requête JSON invalide." }, raw);
    assert.deepEqual(db.writes(), [], raw);
  }
});

test("purge : Validated et Rejected, et rien d'autre", async () => {
  db.use({ contributionInbox: { deleteMany: () => ({ count: 7 }) } });

  const res = await purge(json({ statuses: ["Validated", "Rejected"] }, "DELETE"));

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { deleted: 7 });
  assert.deepEqual(db.calls[0].args, [{ where: { status: { in: ["Validated", "Rejected"] } } }]);
});

// ── Rejet ────────────────────────────────────────────────────────────

test("rejet : ticket absent → 404, rien d'écrit", async () => {
  db.use({ contributionInbox: { findUnique: () => null } });

  const res = await reject(json({}, "PUT"), ctx());

  assert.equal(res.status, 404);
  assert.deepEqual(db.writes(), []);
});

test("rejet : un ADMIN rejette un ticket en attente", async () => {
  session.as("ADMIN");
  db.use({
    contributionInbox: {
      findUnique: () => ({ id: TICKET_ID, status: "Pending_Admin" }),
      update: ({ data }: { data: { status: string } }) => ({ id: TICKET_ID, ...data }),
    },
  });

  const res = await reject(json({}, "PUT"), ctx());

  assert.equal(res.status, 200);
  assert.equal((await res.json()).ticket.status, "Rejected");
  assert.deepEqual(db.writes()[0].args, [{ where: { id: TICKET_ID }, data: { status: "Rejected" } }]);
});

test("rejet : un ticket validé ou déjà rejeté n'est pas touché", async () => {
  for (const status of ["Validated", "Rejected"]) {
    db.use({ contributionInbox: { findUnique: () => ({ id: TICKET_ID, status }) } });
    assert.equal((await reject(json({}, "PUT"), ctx())).status, 400, status);
    assert.deepEqual(db.writes(), [], status);
  }
});

// ── Création de programmes ───────────────────────────────────────────

const MULTI_TICKET = {
  id: TICKET_ID,
  status: "Pending_Admin",
  schoolId: "school-normandie",
  ai_extracted_json: {
    programs: [{ extracted_program_name: "PGE", matched_program_id: "p-pge", data: {} }],
    unmatched_programs: [
      { extracted_program_name: "MSc Data", reason: "inconnu", data: { total_fee: 21000 } },
      { extracted_program_name: "MBA", reason: "inconnu" },
    ],
  },
};

function withMultiTicket(ticket: Record<string, unknown> | null = MULTI_TICKET) {
  db.use({
    contributionInbox: {
      findUnique: () => ticket,
      update: ({ data }: { data: unknown }) => ({ id: TICKET_ID, data }),
    },
    program: {
      upsert: ({ create }: { create: { schoolId: string; name: string } }) => ({
        id: `p-${create.name.toLowerCase().replace(/\s+/g, "-")}`,
        name: create.name,
        schoolId: create.schoolId,
      }),
    },
  });
}

test("création de programmes : ticket absent → 404, rien d'écrit", async () => {
  withMultiTicket(null);

  const res = await createPrograms(json({ programNames: ["MSc Data"] }), ctx());

  assert.equal(res.status, 404);
  assert.deepEqual(db.writes(), []);
});

test("création de programmes : pour la seule école du ticket, et rattachés dans le ticket", async () => {
  session.as("ADMIN");
  withMultiTicket();

  const res = await createPrograms(json({ programNames: [" MSc Data ", "", "MBA"] }), ctx());

  assert.equal(res.status, 200);
  const upserts = db.writes().filter((c) => c.model === "program");
  assert.deepEqual(
    // Étape 5 : l'auteur est l'admin, l'origine l'IA (contentOf le vérifie).
    upserts.map((c) => contentOf((c.args[0] as { create: unknown }).create, "test-admin", "AI")),
    [
      { schoolId: "school-normandie", name: "MSc Data" },
      { schoolId: "school-normandie", name: "MBA" },
    ]
  );
  // Clé d'unicité (schoolId, name) : jamais une autre école.
  assert.ok(
    upserts.every(
      (c) =>
        (c.args[0] as { where: { schoolId_name: { schoolId: string } } }).where.schoolId_name.schoolId ===
        "school-normandie"
    )
  );
  const body = await res.json();
  assert.equal(body.count, 2);
  assert.deepEqual(body.updatedJson.unmatched_programs, []);
  assert.deepEqual(
    body.updatedJson.programs.map((p: { matched_program_id: string }) => p.matched_program_id),
    ["p-pge", "p-msc-data", "p-mba"]
  );
  const ticketUpdate = db.writes().find((c) => c.model === "contributionInbox");
  assert.equal(
    (ticketUpdate?.args[0] as { data: { program_name_mismatch: boolean } }).data.program_name_mismatch,
    false
  );
});

test("création de programmes : un ticket sans école → 400, rien d'écrit", async () => {
  withMultiTicket({ ...MULTI_TICKET, schoolId: null });

  const res = await createPrograms(json({ programNames: ["MBA"] }), ctx());

  assert.equal(res.status, 400);
  assert.deepEqual(db.writes(), []);
});

test("création de programmes : aucun nom → 400, rien d'écrit", async () => {
  for (const body of [{}, { programNames: [] }, { programNames: "MBA" }]) {
    withMultiTicket();
    assert.equal((await createPrograms(json(body), ctx())).status, 400);
    assert.deepEqual(db.writes(), []);
  }
});

test("D120 : création de programmes, un JSON mal formé, ou qui n'est pas un objet → 400, rien d'écrit", async () => {
  for (const raw of ["{pas du json", "[]", "null", "42"]) {
    withMultiTicket();
    const res = await quietly(() => createPrograms(json(raw), ctx()));
    assert.equal(res.status, 400, raw);
    assert.deepEqual(await res.json(), { error: "Corps de requête JSON invalide." }, raw);
    assert.deepEqual(db.writes(), [], raw);
  }
});

test("création de programmes : sans session 401", async () => {
  session.as("none");
  db.use({});

  assert.equal((await createPrograms(json({ programNames: ["MBA"] }), ctx())).status, 401);
  assert.deepEqual(db.calls, []);
});

test("création de programmes : une erreur en transaction → 500, rien d'écrit", async () => {
  withMultiTicket();
  db.use({
    contributionInbox: { findUnique: () => MULTI_TICKET, update: () => ({}) },
    program: {
      upsert: ({ create }: { create: { name: string } }) => {
        if (create.name === "MBA") throw new Error("P2002 interne");
        return { id: "p-1", name: create.name };
      },
    },
  });

  const res = await quietly(() => createPrograms(json({ programNames: ["MSc Data", "MBA"] }), ctx()));

  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /P2002/);
  assert.deepEqual(db.writes(), []);
});
