/**
 * test/backend-state.test.ts — Ce que /admin/cron dit du backend local
 *
 *     npm run test:ts
 *
 * Plan backend-local, étape 5 : l'écran distingue trois états d'après la
 * réponse de `GET /api/admin/pipeline-status` : *pilotage depuis le poste
 * local* (en ligne, pas de backend), *backend local non lancé*, et *backend
 * prêt*. Tout le reste (jeton absent ou refusé, délai, réponse illisible) est
 * une erreur qui se dit en clair, et plus jamais un « Cold Start ».
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { LOCAL_BACKEND_COMMAND, backendState, describeBackendError } from "../lib/backend-state";

test("200 : backend prêt", () => {
  assert.deepEqual(backendState(200, { status: "ok" }), { kind: "ready" });
  assert.deepEqual(backendState(200, { status: "degraded", startup_errors: ["x"] }), { kind: "ready" });
});

test("en ligne, sans FASTAPI_URL : pilotage depuis le poste local", () => {
  assert.deepEqual(backendState(503, { code: "BACKEND_LOCAL_ONLY", error: "…" }), { kind: "local_only" });
});

test("connexion refusée : backend local non lancé", () => {
  assert.deepEqual(backendState(503, { code: "BACKEND_NOT_RUNNING", error: "…" }), { kind: "not_running" });
});

test("les autres cas sont des erreurs dites en clair", () => {
  assert.deepEqual(backendState(500, { code: "TOKEN_MISSING", error: "INTERNAL_API_TOKEN absente" }), {
    kind: "error",
    message: "INTERNAL_API_TOKEN absente",
  });
  const rejected = backendState(401, { detail: "Token d'authentification invalide" });
  assert.equal(rejected.kind, "error");
  if (rejected.kind === "error") assert.match(rejected.message, /refuse le jeton/);
  const timeout = backendState(504, { code: "BACKEND_TIMEOUT", error: "Le backend n'a pas répondu en 10 s." });
  assert.deepEqual(timeout, { kind: "error", message: "Le backend n'a pas répondu en 10 s." });
  assert.deepEqual(backendState(502, null), { kind: "error", message: "Erreur du backend (HTTP 502)" });
});

test("message d'erreur : Next.js, puis le détail de FastAPI sous ses trois formes", () => {
  // Réponse de Next.js (garde, relais) : son `error`.
  assert.equal(
    describeBackendError(403, { error: "Accès refusé. Droits ADMIN requis." }),
    "Accès refusé. Droits ADMIN requis.",
  );
  // FastAPI : détail en texte, en objet {code, message}, ou liste de validation (422).
  assert.equal(describeBackendError(404, { detail: "École introuvable" }), "École introuvable");
  assert.equal(
    describeBackendError(409, { detail: { code: "ALREADY_RUNNING", message: "Une exécution tourne déjà" } }),
    "Une exécution tourne déjà",
  );
  assert.equal(
    describeBackendError(422, { detail: [{ msg: "Input should be a valid boolean" }, { msg: "Extra inputs are not permitted" }] }),
    "Requête refusée par le backend : Input should be a valid boolean ; Extra inputs are not permitted",
  );
  // Un 401 du backend : le jeton diffère d'un côté à l'autre.
  assert.match(describeBackendError(401, { detail: "Token d'authentification invalide" }), /INTERNAL_API_TOKEN/);
  assert.equal(describeBackendError(500, "pas un objet"), "Erreur du backend (HTTP 500)");
});

test("la commande de lancement citée existe aujourd'hui (npm run local arrive à l'étape 6)", () => {
  assert.match(LOCAL_BACKEND_COMMAND, /uvicorn backend\.main:app/);
  assert.doesNotMatch(LOCAL_BACKEND_COMMAND, /0\.0\.0\.0/);
});
