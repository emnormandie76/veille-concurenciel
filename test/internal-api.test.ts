/**
 * test/internal-api.test.ts — Où joindre le backend, et avec quel jeton
 *
 *     npm run test:ts
 *
 * Défaut F5 du plan backend-local (étape 5) : sans `FASTAPI_URL`, Next.js se
 * repliait en silence sur `localhost:8000`. Sur Vercel, cela donnait 4 s
 * d'attente puis « Cold Start ». Sans jeton, il envoyait `Bearer null`, et le
 * 401 du backend s'affichait comme une « erreur du backend ».
 *
 * `backendTarget()` dit désormais pourquoi le backend n'est pas joignable,
 * avant tout appel réseau : `BACKEND_LOCAL_ONLY` (pas d'URL : le site en
 * ligne), `TOKEN_MISSING` (URL sans jeton).
 */

import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { backendTarget, fastapiUrl, internalApiToken } from "../lib/internal-api";

const VARS = ["FASTAPI_URL", "INTERNAL_API_TOKEN", "FASTAPI_INTERNAL_TOKEN"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  mock.restoreAll();
});

// En premier : l'avertissement de l'ancien nom n'est émis qu'une fois par
// processus, et node --test lance chaque fichier dans son propre processus.
test("l'ancien nom du jeton est accepté, avec un seul avertissement, sans le jeton", () => {
  const warn = mock.method(console, "warn", () => {});
  process.env.FASTAPI_URL = "http://127.0.0.1:8000";
  process.env.FASTAPI_INTERNAL_TOKEN = "jeton-ancien-nom";

  assert.equal(internalApiToken(), "jeton-ancien-nom");
  assert.deepEqual(backendTarget(), {
    ok: true,
    url: "http://127.0.0.1:8000",
    token: "jeton-ancien-nom",
  });
  internalApiToken();

  assert.equal(warn.mock.callCount(), 1);
  const message = String(warn.mock.calls[0].arguments[0]);
  assert.match(message, /INTERNAL_API_TOKEN/);
  assert.doesNotMatch(message, /jeton-ancien-nom/);
});

test("URL absente : BACKEND_LOCAL_ONLY, même avec un jeton ; plus de repli sur localhost", () => {
  process.env.INTERNAL_API_TOKEN = "jeton";

  assert.equal(fastapiUrl(), null);
  assert.deepEqual(backendTarget(), { ok: false, code: "BACKEND_LOCAL_ONLY" });
});

test("URL vide ou faite d'espaces : comme absente", () => {
  process.env.INTERNAL_API_TOKEN = "jeton";
  for (const value of ["", "   "]) {
    process.env.FASTAPI_URL = value;
    assert.equal(fastapiUrl(), null);
    assert.deepEqual(backendTarget(), { ok: false, code: "BACKEND_LOCAL_ONLY" });
  }
});

test("URL sans jeton : TOKEN_MISSING", () => {
  process.env.FASTAPI_URL = "http://127.0.0.1:8000";

  assert.equal(internalApiToken(), null);
  assert.deepEqual(backendTarget(), { ok: false, code: "TOKEN_MISSING" });
});

test("URL et jeton : la cible, sans barre finale", () => {
  process.env.FASTAPI_URL = "http://127.0.0.1:8000/";
  process.env.INTERNAL_API_TOKEN = "jeton";

  assert.deepEqual(backendTarget(), { ok: true, url: "http://127.0.0.1:8000", token: "jeton" });
});

test("le nom canonique l'emporte sur l'ancien", () => {
  process.env.FASTAPI_URL = "http://127.0.0.1:8000";
  process.env.INTERNAL_API_TOKEN = "canonique";
  process.env.FASTAPI_INTERNAL_TOKEN = "ancien";

  assert.equal(internalApiToken(), "canonique");
});
