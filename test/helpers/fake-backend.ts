/**
 * test/helpers/fake-backend.ts — Faux backend FastAPI pour les routes qui le relaient
 *
 *     const backend = installFakeBackend();     // avant d'importer la route
 *     backend.env({ url: "http://127.0.0.1:8000", token: "jeton" });
 *     backend.reply(200, { status: "ok" });
 *     // … appel du handler …
 *     assert.equal(backend.calls.length, 1);
 *
 * `installFakeBackend` remplace `fetch` (global) une fois pour tout le
 * fichier : node --test lance chaque fichier dans son propre processus. Chaque
 * test choisit la réponse : `reply` (JSON), `replyText` (corps brut),
 * `refuse` (connexion refusée, comme un backend non lancé) ou `hang` (aucune
 * réponse, jusqu'à l'abandon par la route). Sans choix, un appel lève une
 * erreur explicite : une route qui appelle le backend alors qu'elle ne devrait
 * pas le fait savoir. Aucun appel ne sort du processus.
 *
 * `env` pose `FASTAPI_URL` et le jeton ; `reset` remet tout à zéro (à appeler
 * dans `beforeEach`).
 */

import { mock } from "node:test";

export interface BackendCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Corps relu en JSON, ou `undefined` s'il n'y en a pas. */
  body: unknown;
  signal: AbortSignal | null;
}

type Behaviour =
  | { kind: "unset" }
  | { kind: "reply"; status: number; text: string }
  | { kind: "refuse" }
  | { kind: "hang" };

export interface FakeBackend {
  /** Appels reçus depuis le dernier `reset()`, dans l'ordre. */
  calls: BackendCall[];
  reply(status: number, body: unknown): void;
  replyText(status: number, text: string): void;
  refuse(): void;
  hang(): void;
  /** Résolue au premier appel reçu (pour avancer les minuteries ensuite). */
  called(): Promise<BackendCall>;
  env(vars: { url?: string; token?: string; legacyToken?: string }): void;
  reset(): void;
}

const ENV_VARS = ["FASTAPI_URL", "INTERNAL_API_TOKEN", "FASTAPI_INTERNAL_TOKEN"] as const;

function connectionRefused(): TypeError {
  const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8000"), {
    code: "ECONNREFUSED",
  });
  return Object.assign(new TypeError("fetch failed"), { cause });
}

function abortError(): Error {
  return new DOMException("This operation was aborted", "AbortError");
}

export function installFakeBackend(): FakeBackend {
  const calls: BackendCall[] = [];
  let behaviour: Behaviour = { kind: "unset" };
  let waiters: ((call: BackendCall) => void)[] = [];

  async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const call: BackendCall = {
      url: String(input),
      method: (init.method ?? "GET").toUpperCase(),
      headers,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      signal: init.signal ?? null,
    };
    calls.push(call);
    const pending = waiters;
    waiters = [];
    pending.forEach((resolve) => resolve(call));

    switch (behaviour.kind) {
      case "unset":
        throw new Error(`Faux backend : appel inattendu à ${call.method} ${call.url}.`);
      case "refuse":
        throw connectionRefused();
      case "hang":
        return new Promise<Response>((_resolve, reject) => {
          const signal = init.signal;
          if (!signal) return;
          if (signal.aborted) reject(abortError());
          signal.addEventListener("abort", () => reject(abortError()), { once: true });
        });
      case "reply":
        return new Response(behaviour.text, {
          status: behaviour.status,
          headers: { "Content-Type": "application/json" },
        });
    }
  }

  mock.method(globalThis, "fetch", fakeFetch);

  return {
    calls,
    reply(status, body) {
      behaviour = { kind: "reply", status, text: JSON.stringify(body) };
    },
    replyText(status, text) {
      behaviour = { kind: "reply", status, text };
    },
    refuse() {
      behaviour = { kind: "refuse" };
    },
    hang() {
      behaviour = { kind: "hang" };
    },
    called() {
      return new Promise((resolve) => waiters.push(resolve));
    },
    env({ url, token, legacyToken }) {
      for (const name of ENV_VARS) delete process.env[name];
      if (url !== undefined) process.env.FASTAPI_URL = url;
      if (token !== undefined) process.env.INTERNAL_API_TOKEN = token;
      if (legacyToken !== undefined) process.env.FASTAPI_INTERNAL_TOKEN = legacyToken;
    },
    reset() {
      calls.length = 0;
      behaviour = { kind: "unset" };
      waiters = [];
      for (const name of ENV_VARS) delete process.env[name];
    },
  };
}
