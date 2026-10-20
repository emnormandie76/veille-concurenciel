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
 *
 * Étape 7 du plan gestion-contenu : chaque job porte `triggered_by`, le nom
 * affiché de qui l'a lancé (D25 : le nom seul, jamais l'identifiant ni
 * l'adresse), lu dans le journal `ResearchLaunch` (D14) : une recherche ciblée
 * par l'id de son job ; une passe due par la fenêtre de son lancement, au plus
 * N jobs (D40) ; `null` pour un job sans lancement connu (D44 : « non suivi »).
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

type Launcher = { display_name: string | null };

/**
 * Pose la base que lit la route : l'historique, les jobs `rotation` d'une
 * fenêtre (seconde lecture de `pipelineJob`), le journal des lancements et le
 * compte des `Pending_AI`.
 */
function history({
  jobs,
  pending = 0,
  targeted = [],
  lastBefore = null,
  windows = [],
  rotationSince = [],
}: {
  jobs: unknown[];
  pending?: number;
  targeted?: Array<{ job_id: string; triggeredBy: Launcher }>;
  lastBefore?: { launched_at: Date } | null;
  windows?: Array<{ launched_at: Date; max_passes: number; triggeredBy: Launcher }>;
  rotationSince?: Array<{ id: string; started_at: Date }>;
}) {
  db.use({
    pipelineJob: {
      findMany: (args: { where?: { source?: string } }) => (args.where?.source === "rotation" ? rotationSince : jobs),
    },
    contributionInbox: { count: () => pending },
    researchLaunch: {
      findMany: (args: { where: { kind: string } }) => (args.where.kind === "TARGETED" ? targeted : windows),
      findFirst: () => lastBefore,
    },
  });
}

const launchCalls = (method: string) => db.calls.filter((c) => c.model === "researchLaunch" && c.method === method);

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

test("forme de la réponse : les jobs, avec le nom de l'école, l'erreur et le lanceur, et le compte des Pending_AI", async () => {
  // Aucun lancement au journal : les deux jobs sont « non suivis » (D44).
  history({ jobs: [RUNNING_PHASE1, FAILED_PHASE2], pending: 3 });

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
        triggered_by: null,
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
        triggered_by: null,
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
  history({ jobs: [{ ...FAILED_PHASE2, error: "x".repeat(5000) }] });

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

// ── Le lanceur de chaque job (étape 7) ──────────────────────────────

const at = (iso: string) => new Date(`2026-10-20T${iso}Z`);

const rotationJob = (id: string, time: string) => ({
  ...FAILED_PHASE2,
  id,
  status: "completed",
  error: null,
  started_at: at(time),
  updated_at: at(time),
  finished_at: at(time),
});

test("D14 : une recherche ciblée a pour lanceur le compte noté à son lancement, retrouvé par l'id du job", async () => {
  history({
    jobs: [RUNNING_PHASE1, { ...RUNNING_PHASE1, id: "job-sans-trace" }],
    targeted: [{ job_id: "job-1", triggeredBy: { display_name: "Goat" } }],
  });

  const body = await (await call()).json();

  assert.deepEqual(
    body.jobs.map((j: { id: string; triggered_by: string | null }) => [j.id, j.triggered_by]),
    [
      ["job-1", "Goat"],
      ["job-sans-trace", null],
    ]
  );
  const [query] = launchCalls("findMany");
  assert.deepEqual(query.args[0], {
    where: { kind: "TARGETED", status: "STARTED", job_id: { in: ["job-1", "job-sans-trace"] } },
    // Le nom affiché seul (D25) : ni identifiant ni adresse du lanceur.
    select: { job_id: true, triggeredBy: { select: { display_name: true } } },
  });
});

test("D25 : un lanceur sans nom affiché se lit « Compte sans nom » ; ni identifiant ni adresse ne sortent", async () => {
  history({
    jobs: [RUNNING_PHASE1],
    targeted: [{ job_id: "job-1", triggeredBy: { display_name: null } }],
  });

  const res = await call();
  const text = await res.text();

  assert.equal(JSON.parse(text).jobs[0].triggered_by, "Compte sans nom");
  assert.doesNotMatch(text, /test-admin|triggered_by_id|@em-normandie/);
});

test("D40 : une passe due a pour lanceur le lancement de sa fenêtre, au plus N jobs", async () => {
  // Historique du plus récent au plus ancien ; le lancement de 10 h demandait 2 passes.
  const jobs = [rotationJob("r-3", "11:20:00"), rotationJob("r-2", "10:40:00"), rotationJob("r-1", "10:00:05")];
  history({
    jobs,
    lastBefore: { launched_at: at("10:00:00") },
    windows: [{ launched_at: at("10:00:00"), max_passes: 2, triggeredBy: { display_name: "Goat" } }],
    rotationSince: [jobs[2], jobs[1], jobs[0]].map(({ id, started_at }) => ({ id, started_at })),
  });

  const body = await (await call()).json();

  assert.deepEqual(
    body.jobs.map((j: { id: string; triggered_by: string | null }) => [j.id, j.triggered_by]),
    [
      ["r-3", null],
      ["r-2", "Goat"],
      ["r-1", "Goat"],
    ]
  );

  // Le dernier lancement qui a pu partir avant le plus ancien job affiché…
  const [first] = launchCalls("findFirst");
  assert.deepEqual(first.args[0], {
    where: { kind: "DUE_PASSES", status: { not: "NOT_STARTED" }, launched_at: { lte: at("10:00:05") } },
    orderBy: { launched_at: "desc" },
    select: { launched_at: true },
  });
  // …puis tous ceux qui suivent, et les jobs « rotation » depuis : la borne N
  // se compte sur toute la fenêtre, pas sur la seule page affichée.
  const [windows] = launchCalls("findMany");
  assert.deepEqual(windows.args[0], {
    where: { kind: "DUE_PASSES", status: { not: "NOT_STARTED" }, launched_at: { gte: at("10:00:00") } },
    orderBy: { launched_at: "asc" },
    select: { launched_at: true, max_passes: true, triggeredBy: { select: { display_name: true } } },
  });
  const since = db.calls.filter((c) => c.model === "pipelineJob" && c.method === "findMany")[1];
  assert.deepEqual(since.args[0], {
    where: { source: "rotation", started_at: { gte: at("10:00:00"), lte: at("11:20:00") } },
    orderBy: [{ started_at: "asc" }, { id: "asc" }],
    select: { id: true, started_at: true },
  });
});

test("D40 : sans lancement noté avant elles, les passes dues restent sans lanceur", async () => {
  history({ jobs: [rotationJob("r-1", "10:00:05")] });

  const body = await (await call()).json();

  assert.equal(body.jobs[0].triggered_by, null);
  // Aucune fenêtre : les jobs « rotation » ne sont pas relus.
  assert.equal(db.calls.filter((c) => c.model === "pipelineJob").length, 1);
});

test("D44 : un job de l'ancien cron n'a pas de lanceur, et le journal n'est pas lu pour lui", async () => {
  history({ jobs: [{ ...FAILED_PHASE2, id: "c-1", source: "cron" }] });

  const body = await (await call()).json();

  assert.equal(body.jobs[0].triggered_by, null);
  assert.deepEqual(launchCalls("findMany"), []);
  assert.deepEqual(launchCalls("findFirst"), []);
});
