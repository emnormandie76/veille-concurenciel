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
 *
 * Étape 7 du plan gestion-contenu (D14, D41) : le lancement s'écrit dans le
 * journal `ResearchLaunch` **avant** l'appel, au nom de la session (jamais du
 * corps) ; si cette écriture échoue, rien ne part. Après la réponse, l'issue
 * et l'id du job s'y ajoutent ; si ce second temps échoue, la recherche est
 * partie et la réponse du backend revient telle quelle. `PipelineJob`, la
 * table du backend gelé, n'est jamais écrite.
 */

import { afterEach, before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { installFakeBackend } from "../helpers/fake-backend";
import { installFakePrisma } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";
import { installSession } from "../helpers/session";

const db = installFakePrisma();
const backend = installFakeBackend();
const session = installSession();

type Handler = (request: Request) => Promise<Response>;
let POST: Handler;
let TRIGGER_TIMEOUT_MS: number;

before(async () => {
  ({ POST } = await import("../../app/api/admin/trigger-research/route"));
  ({ BACKEND_TIMEOUTS_MS: { trigger: TRIGGER_TIMEOUT_MS } } = await import("../../lib/internal-api"));
});

/** Appels au backend déjà faits quand le journal a été écrit (D41 : 0). */
let backendCallsAtCreate: number | null;

beforeEach(() => {
  backend.reset();
  session.as("ADMIN");
  backendCallsAtCreate = null;
  db.use({
    researchLaunch: {
      create: () => {
        backendCallsAtCreate = backend.calls.length;
        return { id: "launch-1" };
      },
      update: () => ({ id: "launch-1" }),
    },
  });
});

afterEach(() => {
  mock.timers.reset();
  // Chaque requête reçue par le faux doit exister dans le vrai schéma Prisma.
  assert.deepEqual(schemaErrors(db.calls), []);
  // La table du backend gelé n'est jamais écrite par Next.js (D14).
  assert.deepEqual(db.calls.filter((c) => c.model === "pipelineJob"), []);
});

const LOCAL = { url: "http://127.0.0.1:8000", token: "jeton-de-test" };
const SCHOOL_ID = "11111111-2222-3333-4444-555555555555";
const PHASE1 = { school_id: SCHOOL_ID, phase: "1", collect_campus_attachments: false };

const ACCEPTED = {
  message: "Recherche ciblée déclenchée",
  job_id: "job-1",
  school_id: SCHOOL_ID,
  collect_campus_attachments: false,
  status: "queued",
};

function call(body: unknown) {
  return POST(
    new Request("http://localhost/api/admin/trigger-research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

const created = () => db.calls.filter((c) => c.model === "researchLaunch" && c.method === "create");
const updated = () => db.calls.filter((c) => c.model === "researchLaunch" && c.method === "update");

/** L'issue écrite après la réponse. */
function outcome(): Record<string, unknown> {
  const [update] = updated();
  assert.ok(update, "issue du lancement écrite");
  const args = update.args[0] as { where: unknown; data: Record<string, unknown> };
  assert.deepEqual(args.where, { id: "launch-1" });
  return args.data;
}

/** Fait taire console.error le temps d'un appel, et rend ce qui y est passé. */
async function quietly<T>(fn: () => Promise<T>): Promise<{ result: T; logged: string[] }> {
  const original = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
  try {
    return { result: await fn(), logged };
  } finally {
    console.error = original;
  }
}

test("garde ADMIN : sans session 401, USER et GESTIONNAIRE 403, et aucun appel au backend", async () => {
  backend.env(LOCAL);

  session.as("none");
  assert.equal((await call(PHASE1)).status, 401);
  session.as("USER");
  assert.equal((await call(PHASE1)).status, 403);
  session.as("GESTIONNAIRE");
  assert.equal((await call(PHASE1)).status, 403);

  assert.deepEqual(session.guards, ["guardAdmin"]);
  assert.equal(backend.calls.length, 0);
  assert.deepEqual(db.calls, [], "rien n'est noté pour un refus d'accès");
});

test("sans FASTAPI_URL : 503 BACKEND_LOCAL_ONLY, fetch jamais appelé", async () => {
  backend.env({ token: LOCAL.token });

  const res = await call(PHASE1);

  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "BACKEND_LOCAL_ONLY");
  assert.equal(backend.calls.length, 0);
  assert.deepEqual(db.calls, [], "rien ne peut partir : rien n'est noté");
});

test("jeton absent : 500 TOKEN_MISSING, fetch jamais appelé", async () => {
  backend.env({ url: LOCAL.url });

  const res = await call(PHASE1);

  assert.equal(res.status, 500);
  assert.equal((await res.json()).code, "TOKEN_MISSING");
  assert.equal(backend.calls.length, 0);
  assert.deepEqual(db.calls, []);
});

test("connexion refusée : 503 BACKEND_NOT_RUNNING", async () => {
  backend.env(LOCAL);
  backend.refuse();

  const res = await call(PHASE1);

  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "BACKEND_NOT_RUNNING");
  // Le backend n'a rien reçu : le lancement n'est pas parti.
  assert.equal(outcome().status, "NOT_STARTED");
});

test("corps invalide ou illisible : 400, et le backend n'est pas appelé", async () => {
  backend.env(LOCAL);

  for (const body of [{ school_id: SCHOOL_ID }, { phase: "1" }, "{pas du json"]) {
    const res = await call(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(typeof (await res.json()).error, "string");
  }
  assert.equal(backend.calls.length, 0);
  assert.deepEqual(db.calls, [], "une demande refusée n'est pas un lancement");
});

test("relais : le corps relu part au backend, la réponse revient telle quelle", async () => {
  backend.env(LOCAL);
  backend.reply(200, ACCEPTED);

  const res = await call(PHASE1);

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), ACCEPTED);
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

test("D41 : le lancement s'écrit avant l'appel, au nom de la session, jamais du corps", async () => {
  backend.env(LOCAL);
  backend.reply(200, ACCEPTED);

  await call({ ...PHASE1, triggered_by_id: "intrus", triggered_by: "intrus", user_id: "intrus" });

  assert.equal(backendCallsAtCreate, 0, "écrit avant l'appel au backend");
  const [create] = created();
  assert.ok(create);
  assert.deepEqual(create.args[0], {
    data: {
      kind: "TARGETED",
      triggered_by_id: "test-admin",
      max_passes: null,
      // Ce qui part au backend, et l'école de l'adresse.
      request: {
        school_id: SCHOOL_ID,
        phase: "1",
        program_id: null,
        categories: null,
        collect_campus_attachments: false,
      },
    },
    select: { id: true },
  });
  // Ni heure ni état envoyés : la base date le lancement (D40) et le met « en attente ».
  assert.equal(JSON.stringify(create.args).includes("intrus"), false);
});

test("D41 : après un 200, l'id du job et « parti » s'ajoutent au lancement", async () => {
  backend.env(LOCAL);
  backend.reply(200, ACCEPTED);

  await call(PHASE1);

  assert.deepEqual(outcome(), {
    status: "STARTED",
    http_status: 200,
    job_id: "job-1",
    detail: "Recherche ciblée déclenchée",
  });
});

test("D41 : si le lancement ne peut pas s'écrire, rien ne part (500)", async () => {
  backend.env(LOCAL);
  backend.reply(200, ACCEPTED);
  db.use({
    researchLaunch: {
      create: () => {
        throw new Error("P1001: Can't reach database server at ep-secret-host");
      },
    },
  });

  const { result: res, logged } = await quietly(() => call(PHASE1));

  assert.equal(res.status, 500);
  const body = await res.json();
  assert.match(body.error, /rien n'est parti/);
  assert.equal(JSON.stringify(body).includes("ep-secret-host"), false);
  assert.equal(backend.calls.length, 0, "aucune dépense sans trace");
  assert.equal(logged.length, 1);
});

test("D41 : si l'issue ne peut pas s'écrire, la recherche est partie : la réponse du backend revient telle quelle", async () => {
  backend.env(LOCAL);
  backend.reply(200, ACCEPTED);
  db.use({
    researchLaunch: {
      create: () => ({ id: "launch-1" }),
      update: () => {
        throw new Error("P1001: Can't reach database server");
      },
    },
  });

  const { result: res, logged } = await quietly(() => call(PHASE1));

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), ACCEPTED);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /launch-1/);
});

test("un refus du backend passe tel quel, et le lancement n'est pas parti", async () => {
  backend.env(LOCAL);
  const refusal = { detail: "Les catégories sont requises quand un programme est spécifié en Phase 2" };
  backend.reply(400, refusal);

  const res = await call({ school_id: SCHOOL_ID, phase: "2", program_id: "p1" });

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), refusal);
  assert.deepEqual(outcome(), {
    status: "NOT_STARTED",
    http_status: 400,
    job_id: null,
    detail: refusal.detail,
  });
});

test("école occupée (409 ALREADY_RUNNING) : transmis tel quel, rien de parti", async () => {
  backend.env(LOCAL);
  const busy = {
    detail: { code: "ALREADY_RUNNING", message: "Une tâche est déjà en cours pour cette école (job j-0, Phase 1 — Cartographie)", job_id: "j-0" },
  };
  backend.reply(409, busy);

  const res = await call(PHASE1);

  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), busy);
  const data = outcome();
  assert.equal(data.status, "NOT_STARTED");
  // L'id d'un job déjà en cours n'est pas celui de ce lancement.
  assert.equal(data.job_id, null);
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
  // Issue inconnue : le lancement reste sans job relié.
  const data = outcome();
  assert.equal(data.status, "UNKNOWN");
  assert.equal(data.job_id, null);
});
