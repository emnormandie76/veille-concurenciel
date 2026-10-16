/**
 * test/api/pipeline-jobs.test.ts — GET /api/admin/pipeline-jobs
 *
 *     npm run test:ts
 *
 * L'historique de /admin/cron, lu en base par Prisma seul : il s'affiche
 * aussi en ligne, où le backend n'existe pas (plan backend-local, étape 5).
 * Les 30 derniers `PipelineJob`, avec le nom de l'école et l'erreur d'un job en
 * échec (décision du propriétaire du 14 octobre 2026), plus le nombre de
 * contributions `Pending_AI` qui attendent le backend local.
 */

import { afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { installFakePrisma } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";
import { installSession } from "../helpers/session";

const db = installFakePrisma();

// Chaque requête reçue par le faux doit exister dans le vrai schéma Prisma
// (test/helpers/prisma-schema.ts).
afterEach(() => {
  assert.deepEqual(schemaErrors(db.calls), []);
});
const session = installSession();

type Handler = (request: Request) => Promise<Response>;
let GET: Handler;

before(async () => {
  ({ GET } = await import("../../app/api/admin/pipeline-jobs/route"));
});

beforeEach(() => {
  session.as("ADMIN");
});

const call = () => GET(new Request("http://localhost/api/admin/pipeline-jobs"));

const FAILED_PHASE2 = {
  id: "job-2",
  schoolId: "school-1",
  phase: "Phase 2 — Enrichissement (Auto)",
  source: "rotation",
  status: "failed",
  progress: { current_action: "Terminé" },
  error: "2 cible(s) en échec sur 5 : Pricing — MBA (recherche en échec) ; Ranking — Em Lyon (extraction en échec)",
  started_at: new Date("2026-10-14T08:00:00Z"),
  updated_at: new Date("2026-10-14T09:10:00Z"),
  finished_at: new Date("2026-10-14T09:10:00Z"),
  school: { name: "Em Lyon" },
};

const RUNNING_PHASE1 = {
  id: "job-1",
  schoolId: "school-2",
  phase: "Phase 1 — Cartographie",
  source: "manual",
  status: "running",
  progress: { current_action: "Recherche Research", progress: "1/3" },
  error: null,
  started_at: new Date("2026-10-14T10:00:00Z"),
  updated_at: new Date("2026-10-14T10:02:00Z"),
  finished_at: null,
  school: { name: "Neoma" },
};

test("sans session : 401, et la base n'est jamais lue", async () => {
  session.as("none");
  db.use({});

  const res = await call();

  assert.equal(res.status, 401);
  assert.deepEqual(db.calls, []);
  assert.deepEqual(session.guards, ["guardAdmin"]);
});

test("l'historique de l'IA est réservé à l'admin : un USER ou un GESTIONNAIRE reçoit 403, rien de lu", async () => {
  for (const profile of ["USER", "GESTIONNAIRE"] as const) {
    session.as(profile);
    db.use({});
    assert.equal((await call()).status, 403, profile);
    assert.deepEqual(db.calls, []);
  }
});

test("forme de la réponse : les jobs, avec le nom de l'école et l'erreur, et le compte des Pending_AI", async () => {
  db.use({
    pipelineJob: { findMany: () => [RUNNING_PHASE1, FAILED_PHASE2] },
    contributionInbox: { count: () => 3 },
  });

  const res = await call();

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    jobs: [
      {
        id: "job-1",
        school_id: "school-2",
        school_name: "Neoma",
        phase: "Phase 1 — Cartographie",
        source: "manual",
        status: "running",
        progress: { current_action: "Recherche Research", progress: "1/3" },
        error: null,
        started_at: "2026-10-14T10:00:00.000Z",
        updated_at: "2026-10-14T10:02:00.000Z",
        finished_at: null,
      },
      {
        id: "job-2",
        school_id: "school-1",
        school_name: "Em Lyon",
        phase: "Phase 2 — Enrichissement (Auto)",
        source: "rotation",
        status: "failed",
        progress: { current_action: "Terminé" },
        error: FAILED_PHASE2.error,
        started_at: "2026-10-14T08:00:00.000Z",
        updated_at: "2026-10-14T09:10:00.000Z",
        finished_at: "2026-10-14T09:10:00.000Z",
      },
    ],
    pending_ai: 3,
  });
});

test("requêtes : les 30 plus récents, et les seuls Pending_AI comptés", async () => {
  db.use({
    pipelineJob: { findMany: () => [] },
    contributionInbox: { count: () => 0 },
  });

  await call();

  const findMany = db.calls.find((c) => c.model === "pipelineJob" && c.method === "findMany");
  assert.ok(findMany);
  const query = findMany.args[0] as {
    orderBy: unknown;
    take: number;
    select: Record<string, unknown>;
  };
  assert.deepEqual(query.orderBy, { started_at: "desc" });
  assert.equal(query.take, 30);
  assert.deepEqual(query.select.school, { select: { name: true } });

  const count = db.calls.find((c) => c.model === "contributionInbox" && c.method === "count");
  assert.deepEqual(count?.args, [{ where: { status: "Pending_AI" } }]);
});

test("une erreur trop longue est bornée à 2 000 caractères", async () => {
  db.use({
    pipelineJob: { findMany: () => [{ ...FAILED_PHASE2, error: "x".repeat(5000) }] },
    contributionInbox: { count: () => 0 },
  });

  const body = await (await call()).json();

  assert.equal(body.jobs[0].error.length, 2000);
});

test("base en erreur : 500, sans le message interne", async () => {
  db.use({
    pipelineJob: {
      findMany: () => {
        throw new Error("P1001: Can't reach database server at ep-secret-host");
      },
    },
    contributionInbox: { count: () => 0 },
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    const res = await call();

    assert.equal(res.status, 500);
    const text = await res.text();
    assert.doesNotMatch(text, /ep-secret-host|P1001/);
    assert.equal(typeof JSON.parse(text).error, "string");
  } finally {
    console.error = originalError;
  }
});
