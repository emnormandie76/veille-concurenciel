/**
 * test/api/pipeline-status.test.ts — GET /api/admin/pipeline-status (défaut F5)
 *
 *     npm run test:ts
 *
 * La route relaie `GET /internal/pipeline-status` du backend local. En ligne
 * (Vercel), `FASTAPI_URL` est absente : la route répond 503
 * `BACKEND_LOCAL_ONLY` tout de suite, sans appel réseau, au lieu d'attendre
 * 4 s un `localhost:8000` qui n'existe pas. Jeton absent : 500 explicite,
 * jamais `Bearer null`. Backend non lancé : 503 `BACKEND_NOT_RUNNING`. Sinon,
 * la réponse du backend passe telle quelle (statut et corps).
 */

import { afterEach, before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { installFakeBackend } from "../helpers/fake-backend";
import { installSession } from "../helpers/session";

const backend = installFakeBackend();
const session = installSession();

type Handler = (request: Request) => Promise<Response>;
let GET: Handler;
let STATUS_TIMEOUT_MS: number;

before(async () => {
  ({ GET } = await import("../../app/api/admin/pipeline-status/route"));
  ({ BACKEND_TIMEOUTS_MS: { status: STATUS_TIMEOUT_MS } } = await import("../../lib/internal-api"));
});

beforeEach(() => {
  backend.reset();
  session.as("MODERATOR");
});

afterEach(() => {
  mock.timers.reset();
});

const LOCAL = { url: "http://127.0.0.1:8000", token: "jeton-de-test" };

const call = () => GET(new Request("http://localhost/api/admin/pipeline-status"));

test("sans session : 401, et le backend n'est pas appelé", async () => {
  session.as("none");
  backend.env(LOCAL);

  const res = await call();

  assert.equal(res.status, 401);
  assert.equal(backend.calls.length, 0);
  assert.deepEqual(session.guards, ["guardAuth"]);
});

test("sans FASTAPI_URL (en ligne) : 503 BACKEND_LOCAL_ONLY immédiat, fetch jamais appelé", async () => {
  backend.env({ token: LOCAL.token });

  const res = await call();

  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, "BACKEND_LOCAL_ONLY");
  assert.equal(typeof body.error, "string");
  assert.equal(backend.calls.length, 0);
});

test("jeton absent : 500 TOKEN_MISSING, jamais de Bearer null", async () => {
  backend.env({ url: LOCAL.url });

  const res = await call();

  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.code, "TOKEN_MISSING");
  assert.match(body.error, /INTERNAL_API_TOKEN/);
  assert.equal(backend.calls.length, 0);
});

test("connexion refusée : 503 BACKEND_NOT_RUNNING", async () => {
  backend.env(LOCAL);
  backend.refuse();

  const res = await call();

  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, "BACKEND_NOT_RUNNING");
  assert.match(body.error, /ECONNREFUSED/);
  assert.equal(backend.calls.length, 1);
});

test("réponse du backend transmise telle quelle, avec le jeton", async () => {
  backend.env(LOCAL);
  const status = {
    status: "degraded",
    database: "connected",
    startup_errors: ["Gestionnaire de clés Tavily : aucune clé"],
    scheduler: { running: true, rotation: { error: "P1001" } },
  };
  backend.reply(200, status);

  const res = await call();

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), status);
  assert.equal(backend.calls.length, 1);
  const [sent] = backend.calls;
  assert.equal(sent.url, "http://127.0.0.1:8000/internal/pipeline-status");
  assert.equal(sent.method, "GET");
  assert.equal(sent.headers.authorization, "Bearer jeton-de-test");
});

test("une erreur du backend passe aussi telle quelle (statut et corps)", async () => {
  backend.env(LOCAL);
  backend.reply(401, { detail: "Token d'authentification invalide" });

  const res = await call();

  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { detail: "Token d'authentification invalide" });
});

test("corps illisible : 502 BACKEND_BAD_RESPONSE", async () => {
  backend.env(LOCAL);
  backend.replyText(500, "Internal Server Error");

  const res = await call();

  assert.equal(res.status, 502);
  assert.equal((await res.json()).code, "BACKEND_BAD_RESPONSE");
});

test("backend muet : 504 BACKEND_TIMEOUT au bout du délai, pas avant", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  backend.env(LOCAL);
  backend.hang();

  const pending = call();
  const sent = await backend.called();
  mock.timers.tick(STATUS_TIMEOUT_MS - 1);
  assert.equal(sent.signal?.aborted, false);
  mock.timers.tick(1);
  const res = await pending;

  assert.equal(res.status, 504);
  assert.equal((await res.json()).code, "BACKEND_TIMEOUT");
});
