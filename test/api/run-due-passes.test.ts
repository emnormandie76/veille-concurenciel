/**
 * test/api/run-due-passes.test.ts — POST /api/admin/run-due-passes
 *
 *     npm run test:ts
 *
 * Les passes dues, lancées depuis /admin/cron : ADMIN seulement, relayées vers
 * `POST /internal/run-due-passes` (plan backend-local, étapes 3 et 5).
 *
 * - Corps : `{max_passes: 1..5, dry_run: booléen}`. `dry_run` est exigé et doit
 *   être un vrai booléen, et un champ inconnu est refusé, comme côté backend :
 *   une passe payante ne part jamais par défaut, ni sur `"false"`, ni sur une
 *   faute de frappe (`dryRun`). Refus en 400, sans appel au backend.
 * - Mêmes règles de relais que pipeline-status : 503 `BACKEND_LOCAL_ONLY`
 *   sans appel ; 500 `TOKEN_MISSING` ; 503 `BACKEND_NOT_RUNNING` ; sinon la
 *   réponse du backend (200, 202, 409, 503…) passe telle quelle.
 * - Une passe réelle attend la synchro `/usage` du backend, jusqu'à 20 s,
 *   avant de répondre : la route ne coupe pas avant.
 */

import { afterEach, before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { installFakeBackend } from "../helpers/fake-backend";
import { installSession } from "../helpers/session";

const backend = installFakeBackend();
const session = installSession();

type Handler = (request: Request) => Promise<Response>;
let POST: Handler;
let DUE_PASSES_TIMEOUT_MS: number;

before(async () => {
  ({ POST } = await import("../../app/api/admin/run-due-passes/route"));
  ({ BACKEND_TIMEOUTS_MS: { duePasses: DUE_PASSES_TIMEOUT_MS } } = await import("../../lib/internal-api"));
});

beforeEach(() => {
  backend.reset();
  session.as("ADMIN");
});

afterEach(() => {
  mock.timers.reset();
});

const LOCAL = { url: "http://127.0.0.1:8000", token: "jeton-de-test" };

function call(body: unknown) {
  return POST(
    new Request("http://localhost/api/admin/run-due-passes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

const PLANNED_REPORT = {
  dry_run: false,
  max_passes: 2,
  status: "planned",
  detail: "1 passe(s) au départ : Em Lyon, Phase 2, ~785 crédits",
  monthly_ceiling: 7000,
  month_credits_used: 1240,
  due_count: 3,
  planned: [
    {
      school_name: "Em Lyon",
      phase: "2",
      reason: "interval",
      last_pass_at: "2026-03-01T03:12:00+00:00",
      estimated_credits: 785,
    },
  ],
  launched: [],
  usage_sync: { ok: true, at: "2026-10-14T08:00:00+00:00", failed_keys: [] },
};

test("garde ADMIN : sans session 401, USER et GESTIONNAIRE 403, et aucun appel au backend", async () => {
  backend.env(LOCAL);

  session.as("none");
  assert.equal((await call({ max_passes: 1, dry_run: true })).status, 401);
  session.as("USER");
  assert.equal((await call({ max_passes: 1, dry_run: true })).status, 403);
  session.as("GESTIONNAIRE");
  assert.equal((await call({ max_passes: 1, dry_run: true })).status, 403);

  assert.deepEqual(session.guards, ["guardAdmin"]);
  assert.equal(backend.calls.length, 0);
});

test("sans FASTAPI_URL : 503 BACKEND_LOCAL_ONLY, fetch jamais appelé", async () => {
  backend.env({ token: LOCAL.token });

  const res = await call({ max_passes: 1, dry_run: false });

  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "BACKEND_LOCAL_ONLY");
  assert.equal(backend.calls.length, 0);
});

test("jeton absent : 500 TOKEN_MISSING, fetch jamais appelé", async () => {
  backend.env({ url: LOCAL.url });

  const res = await call({ max_passes: 1, dry_run: true });

  assert.equal(res.status, 500);
  assert.equal((await res.json()).code, "TOKEN_MISSING");
  assert.equal(backend.calls.length, 0);
});

test("connexion refusée : 503 BACKEND_NOT_RUNNING", async () => {
  backend.env(LOCAL);
  backend.refuse();

  const res = await call({ max_passes: 1, dry_run: true });

  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "BACKEND_NOT_RUNNING");
});

test("max_passes hors de 1..5 ou non entier : 400, rien ne part", async () => {
  backend.env(LOCAL);

  for (const max_passes of [0, 6, -1, 1.5, "2", null]) {
    const res = await call({ max_passes, dry_run: true });
    assert.equal(res.status, 400, `max_passes=${JSON.stringify(max_passes)}`);
    assert.match((await res.json()).error, /max_passes/);
  }
  assert.equal(backend.calls.length, 0);
});

test("dry_run absent, non booléen, ou champ inconnu : 400, une passe payante ne part jamais par défaut", async () => {
  backend.env(LOCAL);

  const refused: unknown[] = [
    { max_passes: 1 },
    { max_passes: 1, dry_run: "false" },
    { max_passes: 1, dry_run: 0 },
    { max_passes: 1, dry_run: null },
    { max_passes: 1, dryRun: true },
    { max_passes: 1, dry_run: true, dryRun: false },
    [],
    "null",
    "{pas du json",
  ];
  for (const body of refused) {
    const res = await call(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(typeof (await res.json()).error, "string");
  }
  assert.equal(backend.calls.length, 0);
});

test("simulation : le corps exact part au backend, le 200 revient tel quel", async () => {
  backend.env(LOCAL);
  const report = { ...PLANNED_REPORT, dry_run: true, status: "success" };
  backend.reply(200, report);

  const res = await call({ max_passes: 3, dry_run: true });

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), report);
  const [sent] = backend.calls;
  assert.equal(sent.url, "http://127.0.0.1:8000/internal/run-due-passes");
  assert.equal(sent.method, "POST");
  assert.equal(sent.headers.authorization, "Bearer jeton-de-test");
  assert.deepEqual(sent.body, { max_passes: 3, dry_run: true });
});

test("max_passes absent : 1, comme le backend", async () => {
  backend.env(LOCAL);
  backend.reply(200, { ...PLANNED_REPORT, dry_run: true, max_passes: 1 });

  await call({ dry_run: true });

  assert.deepEqual(backend.calls[0].body, { max_passes: 1, dry_run: true });
});

test("passe réelle : le 202 et le rapport annoncé reviennent tels quels", async () => {
  backend.env(LOCAL);
  backend.reply(202, PLANNED_REPORT);

  const res = await call({ max_passes: 2, dry_run: false });

  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), PLANNED_REPORT);
  assert.deepEqual(backend.calls[0].body, { max_passes: 2, dry_run: false });
});

test("refus du backend (409, 503 USAGE_SYNC_FAILED) : transmis tels quels", async () => {
  backend.env(LOCAL);

  const busy = { detail: { code: "ALREADY_RUNNING", message: "Une exécution tourne déjà" } };
  backend.reply(409, busy);
  let res = await call({ max_passes: 1, dry_run: false });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), busy);

  const sync = {
    detail: {
      code: "USAGE_SYNC_FAILED",
      message: "synchro /usage en échec : ...abc123",
      usage_sync: { ok: false, at: "2026-10-14T08:00:00+00:00", failed_keys: ["...abc123"] },
    },
  };
  backend.reply(503, sync);
  res = await call({ max_passes: 1, dry_run: false });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), sync);
});

test("la route attend la synchro /usage du backend (20 s) sans couper", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  backend.env(LOCAL);
  backend.hang();

  assert.ok(DUE_PASSES_TIMEOUT_MS > 20_000 + 5_000, "le délai doit couvrir la synchro et la planification");
  const pending = call({ max_passes: 1, dry_run: false });
  const sent = await backend.called();
  mock.timers.tick(25_000);
  assert.equal(sent.signal?.aborted, false);

  mock.timers.tick(DUE_PASSES_TIMEOUT_MS - 25_000);
  const res = await pending;
  assert.equal(res.status, 504);
  const body = await res.json();
  assert.equal(body.code, "BACKEND_TIMEOUT");
  // Une passe réelle a pu partir côté backend : l'écran ne doit pas inviter à relancer.
  assert.match(body.error, /a pu partir/);
});
