/**
 * test/api/trigger-research.test.ts — POST /api/admin/trigger-research (défaut F5)
 *
 *     npm run test:ts
 *
 * Recherche ciblée lancée depuis /admin/cron : ADMIN seulement (elle paie
 * Research), relayée vers `POST /internal/trigger-targeted-research/{id}`. Mêmes
 * règles que pipeline-status : en ligne, 503 `BACKEND_LOCAL_ONLY` sans appel ;
 * jeton absent, 500 ; backend non lancé, 503 `BACKEND_NOT_RUNNING` ; sinon la
 * réponse du backend passe telle quelle. Le corps est relu par
 * lib/trigger-research.ts (testé à part, test/trigger-research.test.ts).
 */

import { afterEach, before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { installFakeBackend } from "../helpers/fake-backend";
import { installSession } from "../helpers/session";

const backend = installFakeBackend();
const session = installSession();

type Handler = (request: Request) => Promise<Response>;
let POST: Handler;
let TRIGGER_TIMEOUT_MS: number;

before(async () => {
  ({ POST } = await import("../../app/api/admin/trigger-research/route"));
  ({ BACKEND_TIMEOUTS_MS: { trigger: TRIGGER_TIMEOUT_MS } } = await import("../../lib/internal-api"));
});

beforeEach(() => {
  backend.reset();
  session.as("ADMIN");
});

afterEach(() => {
  mock.timers.reset();
});

const LOCAL = { url: "http://127.0.0.1:8000", token: "jeton-de-test" };
const SCHOOL_ID = "11111111-2222-3333-4444-555555555555";
const PHASE1 = { school_id: SCHOOL_ID, phase: "1", collect_campus_attachments: false };

function call(body: unknown) {
  return POST(
    new Request("http://localhost/api/admin/trigger-research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

test("garde ADMIN : sans session 401, MODERATOR 403, et aucun appel au backend", async () => {
  backend.env(LOCAL);

  session.as("none");
  assert.equal((await call(PHASE1)).status, 401);
  session.as("MODERATOR");
  assert.equal((await call(PHASE1)).status, 403);

  assert.deepEqual(session.guards, ["guardAdmin"]);
  assert.equal(backend.calls.length, 0);
});

test("sans FASTAPI_URL : 503 BACKEND_LOCAL_ONLY, fetch jamais appelé", async () => {
  backend.env({ token: LOCAL.token });

  const res = await call(PHASE1);

  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "BACKEND_LOCAL_ONLY");
  assert.equal(backend.calls.length, 0);
});

test("jeton absent : 500 TOKEN_MISSING, fetch jamais appelé", async () => {
  backend.env({ url: LOCAL.url });

  const res = await call(PHASE1);

  assert.equal(res.status, 500);
  assert.equal((await res.json()).code, "TOKEN_MISSING");
  assert.equal(backend.calls.length, 0);
});

test("connexion refusée : 503 BACKEND_NOT_RUNNING", async () => {
  backend.env(LOCAL);
  backend.refuse();

  const res = await call(PHASE1);

  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "BACKEND_NOT_RUNNING");
});

test("corps invalide ou illisible : 400, et le backend n'est pas appelé", async () => {
  backend.env(LOCAL);

  for (const body of [{ school_id: SCHOOL_ID }, { phase: "1" }, "{pas du json"]) {
    const res = await call(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(typeof (await res.json()).error, "string");
  }
  assert.equal(backend.calls.length, 0);
});

test("relais : le corps relu part au backend, la réponse revient telle quelle", async () => {
  backend.env(LOCAL);
  const accepted = {
    message: "Recherche ciblée déclenchée",
    job_id: "job-1",
    school_id: SCHOOL_ID,
    collect_campus_attachments: false,
    status: "queued",
  };
  backend.reply(200, accepted);

  const res = await call(PHASE1);

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), accepted);
  const [sent] = backend.calls;
  assert.equal(sent.url, `http://127.0.0.1:8000/internal/trigger-targeted-research/${SCHOOL_ID}`);
  assert.equal(sent.method, "POST");
  assert.equal(sent.headers.authorization, "Bearer jeton-de-test");
  assert.deepEqual(sent.body, {
    phase: "1",
    program_id: null,
    categories: null,
    collect_campus_attachments: false,
  });
});

test("un refus du backend passe tel quel", async () => {
  backend.env(LOCAL);
  const refusal = { detail: "Les catégories sont requises quand un programme est spécifié en Phase 2" };
  backend.reply(400, refusal);

  const res = await call({ school_id: SCHOOL_ID, phase: "2", program_id: "p1" });

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), refusal);
});

test("délai dépassé : 504, en disant que la recherche a pu partir", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  backend.env(LOCAL);
  backend.hang();

  const pending = call(PHASE1);
  await backend.called();
  mock.timers.tick(TRIGGER_TIMEOUT_MS);
  const res = await pending;

  assert.equal(res.status, 504);
  const body = await res.json();
  assert.equal(body.code, "BACKEND_TIMEOUT");
  assert.match(body.error, /a pu partir/);
});
