/**
 * test/rate-limit.test.ts — Limitation de débit (lib/rate-limit.ts)
 *
 *     npm run test:ts
 *
 * L'implémentation unique du projet (architecture/gestion-contenu.md §8.1). Upstash Redis
 * si ses deux variables sont posées ; sinon, ou s'il répond mal, repli sur un
 * compteur mémoire, et c'est journalisé. Plan backend-local, étape 7 (P0).
 *
 * `fetch` est remplacé : aucun appel ne sort du processus.
 */

import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { checkRateLimit, clientIp, isSharedStoreConfigured } from "../lib/rate-limit";

const UPSTASH = { url: "https://upstash.invalid/", token: "jeton-de-test" };

type Logged = { warn: string[]; error: string[] };
let logged: Logged;
let fetchCalls: Array<{ url: string; init: RequestInit }>;
let upstashReply: () => Promise<Response>;

beforeEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  logged = { warn: [], error: [] };
  mock.method(console, "warn", (...args: unknown[]) => logged.warn.push(args.join(" ")));
  mock.method(console, "error", (...args: unknown[]) => logged.error.push(args.map(String).join(" ")));
  fetchCalls = [];
  upstashReply = async () => {
    throw new Error("fetch inattendu");
  };
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
    fetchCalls.push({ url: String(input), init });
    return upstashReply();
  });
});

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

function useUpstash(): void {
  process.env.UPSTASH_REDIS_REST_URL = UPSTASH.url;
  process.env.UPSTASH_REDIS_REST_TOKEN = UPSTASH.token;
}

async function attempts(key: string, limit: number, windowMs: number, n: number): Promise<boolean[]> {
  const results: boolean[] = [];
  for (let i = 0; i < n; i++) results.push(await checkRateLimit(key, limit, windowMs));
  return results;
}

// ── Identification de l'appelant ─────────────────────────────────────

test("clientIp : en-têtes de plateforme d'abord, x-forwarded-for en dernier recours", () => {
  const ip = (headers: Record<string, string>) => clientIp(new Headers(headers));

  assert.equal(
    ip({
      "x-vercel-forwarded-for": "203.0.113.7, 10.0.0.1",
      "x-real-ip": "198.51.100.2",
      "x-forwarded-for": "192.0.2.99",
    }),
    "203.0.113.7"
  );
  assert.equal(ip({ "x-real-ip": " 198.51.100.2 ", "x-forwarded-for": "192.0.2.99" }), "198.51.100.2");
  assert.equal(ip({ "x-forwarded-for": "192.0.2.99, 10.0.0.1" }), "192.0.2.99");
  assert.equal(ip({}), "unknown");
});

// ── Repli mémoire ────────────────────────────────────────────────────

test("sans Upstash : le compteur mémoire autorise `limit` requêtes, puis refuse", async () => {
  assert.equal(isSharedStoreConfigured(), false);

  assert.deepEqual(await attempts("test:memoire", 5, 60_000, 7), [true, true, true, true, true, false, false]);
  assert.deepEqual(fetchCalls, []);
  // Premier usage du module dans ce fichier : le repli est journalisé.
  assert.equal(logged.warn.length, 1);
  assert.match(logged.warn[0], /Aucun magasin partagé.*Repli mémoire/);
});

test("sans Upstash : l'avertissement de repli n'est pas répété", async () => {
  await attempts("test:avertissement-a", 5, 60_000, 3);
  await attempts("test:avertissement-b", 5, 60_000, 3);

  assert.deepEqual(logged.warn, []);
});

test("un seau par clé : un autre appelant n'est pas compté avec le premier", async () => {
  await attempts("test:seau-a", 2, 60_000, 3);

  assert.deepEqual(await attempts("test:seau-b", 2, 60_000, 2), [true, true]);
});

test("la fenêtre écoulée, le compteur repart", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });

  assert.deepEqual(await attempts("test:fenetre", 2, 20_000, 3), [true, true, false]);
  mock.timers.tick(20_001);
  assert.deepEqual(await attempts("test:fenetre", 2, 20_000, 1), [true]);
});

// ── Upstash ──────────────────────────────────────────────────────────

function replyCount(count: number): void {
  upstashReply = async () =>
    new Response(JSON.stringify([{ result: count }, { result: 1 }]), { status: 200 });
}

test("avec Upstash : INCR puis EXPIRE NX en un aller-retour, le jeton en en-tête", async () => {
  useUpstash();
  replyCount(1);
  mock.timers.enable({ apis: ["Date"], now: 900_000 * 7 + 5 });

  assert.equal(isSharedStoreConfigured(), true);
  assert.equal(await checkRateLimit("login:203.0.113.7", 5, 900_000), true);

  assert.equal(fetchCalls.length, 1);
  const [{ url, init }] = fetchCalls;
  assert.equal(url, "https://upstash.invalid/pipeline");
  assert.equal(init.method, "POST");
  assert.equal(new Headers(init.headers).get("Authorization"), "Bearer jeton-de-test");
  assert.deepEqual(JSON.parse(String(init.body)), [
    ["INCR", "rl:login:203.0.113.7:7"],
    ["EXPIRE", "rl:login:203.0.113.7:7", "900", "NX"],
  ]);
});

test("avec Upstash : le compte partagé décide, au-delà de la limite c'est refusé", async () => {
  useUpstash();

  replyCount(5);
  assert.equal(await checkRateLimit("test:partage", 5, 60_000), true);
  replyCount(6);
  assert.equal(await checkRateLimit("test:partage", 5, 60_000), false);
  assert.deepEqual(logged.error, []);
});

test("Upstash en erreur HTTP : repli mémoire, et l'erreur est journalisée", async () => {
  useUpstash();
  upstashReply = async () => new Response("indisponible", { status: 503 });

  assert.deepEqual(await attempts("test:upstash-503", 2, 60_000, 3), [true, true, false]);
  assert.equal(fetchCalls.length, 3);
  assert.ok(logged.error.some((line) => line.includes("Upstash a répondu 503")));
});

test("Upstash injoignable : repli mémoire, et l'erreur est journalisée", async () => {
  useUpstash();
  upstashReply = async () => {
    throw new TypeError("fetch failed");
  };

  assert.deepEqual(await attempts("test:upstash-panne", 1, 60_000, 2), [true, false]);
  assert.ok(logged.error.some((line) => line.includes("Upstash injoignable")));
});

test("réponse Upstash illisible : repli mémoire, journalisé", async () => {
  useUpstash();
  upstashReply = async () => new Response(JSON.stringify([{ error: "ERR" }]), { status: 200 });

  assert.equal(await checkRateLimit("test:upstash-illisible", 3, 60_000), true);
  assert.ok(logged.error.some((line) => line.includes("réponse Upstash inattendue")));
});

test("une seule des deux variables Upstash : pas de magasin partagé, aucun appel", async () => {
  process.env.UPSTASH_REDIS_REST_URL = UPSTASH.url;

  assert.equal(isSharedStoreConfigured(), false);
  assert.equal(await checkRateLimit("test:moitie", 3, 60_000), true);
  assert.deepEqual(fetchCalls, []);
});
