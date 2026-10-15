/**
 * test/proxy.test.ts — proxy.ts : limitation de débit et session du back-office
 *
 *     npm run test:ts
 *
 * `proxy.ts` tient lieu de middleware dans Next 16. Il plafonne la connexion
 * (5 tentatives / 15 min / IP), les contributions et l'API v1, et exige une
 * session sur `/admin/*`, `/admin/login` excepté (architecture.md §3.6 et
 * §10.3). Plan backend-local, étape 7 (P0).
 *
 * Le matcher se teste avec `unstable_doesMiddlewareMatch` de
 * `next/experimental/testing/server`. La documentation de Next 16 cite
 * `unstable_doesProxyMatch`, que la version installée (16.3.8) n'exporte pas.
 *
 * Sans Upstash, `lib/rate-limit.ts` compte en mémoire : chaque test prend sa
 * propre IP. La session est lue par next-auth dans un vrai jeton chiffré avec
 * un secret de test ; aucun appel réseau.
 */

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, type NextFetchEvent } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { encode } from "next-auth/jwt";

const SECRET = "secret-de-test-du-proxy-jamais-utilise-ailleurs";
process.env.NEXTAUTH_SECRET = SECRET;
delete process.env.NEXTAUTH_URL;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

type Proxy = (req: NextRequest, event: NextFetchEvent) => Promise<Response | undefined>;
let proxy: Proxy;
let config: { matcher: string[] };

before(async () => {
  const mod = await import("../proxy");
  proxy = mod.default as unknown as Proxy;
  config = mod.config;
});

beforeEach(() => {
  // Le repli mémoire avertit une fois ; l'avertissement n'est pas l'objet ici.
  mock.method(console, "warn", () => {});
});

const EVENT = { waitUntil() {} } as unknown as NextFetchEvent;

function request(path: string, init: { method?: string; ip?: string; headers?: Record<string, string>; cookie?: string } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.ip) headers["x-real-ip"] = init.ip;
  if (init.cookie) headers.cookie = init.cookie;
  return new NextRequest(`http://localhost:3000${path}`, { method: init.method ?? "GET", headers });
}

/** NextResponse.next() : la requête poursuit sa route. */
function passes(res: Response | undefined): boolean {
  return res === undefined || res.headers.get("x-middleware-next") === "1";
}

// ── Matcher ──────────────────────────────────────────────────────────

test("matcher : le back-office, la contribution, la connexion et l'API v1 ; /admin/login libre", () => {
  const runs = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  for (const url of [
    "/admin/inbox",
    "/admin/cron",
    "/admin/schools/abc/manage",
    "/admin/loginx",
    "/api/contribute",
    "/api/auth/callback/credentials",
    "/api/v1/schools",
    "/api/v1/programs/abc/pricing",
  ]) {
    assert.equal(runs(url), true, url);
  }

  for (const url of ["/admin/login", "/admin/login/", "/", "/contribute", "/api-docs", "/api/auth/session"]) {
    assert.equal(runs(url), false, url);
  }
});

test("matcher : les routes /api/admin n'y passent pas, elles portent leur propre garde", () => {
  // guardAuth / guardAdmin, vérifiés par test/api/admin-guards.test.ts.
  assert.equal(unstable_doesMiddlewareMatch({ config, url: "/api/admin/inbox" }), false);
});

// ── Connexion : 5 tentatives par IP et par 15 minutes ────────────────

test("la 6ᵉ tentative de connexion en 15 minutes → 429, avec Retry-After", async () => {
  const results: number[] = [];
  for (let i = 0; i < 6; i++) {
    const res = await proxy(
      request("/api/auth/callback/credentials", { method: "POST", ip: "203.0.113.10" }),
      EVENT
    );
    results.push(passes(res) ? 200 : (res as Response).status);
  }

  assert.deepEqual(results, [200, 200, 200, 200, 200, 429]);
  const blocked = await proxy(
    request("/api/auth/callback/credentials", { method: "POST", ip: "203.0.113.10" }),
    EVENT
  );
  assert.equal(blocked?.status, 429);
  assert.equal(blocked?.headers.get("Retry-After"), "900");
  assert.match((await blocked!.json()).error, /Trop de tentatives/);
});

test("varier x-forwarded-for ne contourne pas le plafond quand la plateforme donne l'IP", async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    const res = await proxy(
      request("/api/auth/callback/credentials", {
        method: "POST",
        ip: "203.0.113.11",
        headers: { "x-forwarded-for": `192.0.2.${i}` },
      }),
      EVENT
    );
    statuses.push(passes(res) ? 200 : (res as Response).status);
  }
  assert.equal(statuses[5], 429);
});

test("seul le POST de connexion est compté ; une autre IP a son propre seau", async () => {
  for (let i = 0; i < 10; i++) {
    const res = await proxy(request("/api/auth/callback/credentials", { ip: "203.0.113.12" }), EVENT);
    assert.ok(passes(res));
  }
  for (let i = 0; i < 5; i++) {
    await proxy(request("/api/auth/callback/credentials", { method: "POST", ip: "203.0.113.13" }), EVENT);
  }
  const other = await proxy(
    request("/api/auth/callback/credentials", { method: "POST", ip: "203.0.113.14" }),
    EVENT
  );
  assert.ok(passes(other));
});

// ── Back-office : session obligatoire ────────────────────────────────

test("/admin/* sans session → redirection vers /admin/login avec callbackUrl", async () => {
  const res = await proxy(request("/admin/inbox?status=Pending_AI"), EVENT);

  assert.ok(res);
  assert.equal(res.status, 307);
  const location = new URL(res.headers.get("location") ?? "");
  assert.equal(location.pathname, "/admin/login");
  assert.equal(location.searchParams.get("callbackUrl"), "/admin/inbox?status=Pending_AI");
});

test("/admin/* avec un jeton de session forgé avec un autre secret → redirection", async () => {
  const token = await encode({ token: { id: "u-admin", sub: "u-admin", role: "ADMIN" }, secret: "un-autre-secret" });

  const res = await proxy(request("/admin/cron", { cookie: `next-auth.session-token=${token}` }), EVENT);

  assert.equal(res?.status, 307);
});

test("/admin/* avec une session valide → la requête passe", async () => {
  const token = await encode({ token: { id: "u-admin", sub: "u-admin", name: "admin", role: "ADMIN" }, secret: SECRET });

  const res = await proxy(request("/admin/cron", { cookie: `next-auth.session-token=${token}` }), EVENT);

  assert.ok(passes(res), `statut ${res?.status}`);
});

test("/admin/login reste libre, même atteint par le proxy", async () => {
  // Le matcher l'exclut ; et next-auth ne redirige jamais sa page de connexion.
  assert.ok(passes(await proxy(request("/admin/login"), EVENT)));
});

// ── Contributions et API publique ────────────────────────────────────

test("/api/contribute : 5 par 20 s et par IP, puis 429", async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    const res = await proxy(request("/api/contribute", { method: "POST", ip: "198.51.100.20" }), EVENT);
    statuses.push(passes(res) ? 200 : (res as Response).status);
  }
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
});

test("/api/v1 : 60 par minute et par IP, la 61ᵉ → 429 ; les pré-vols OPTIONS ne comptent pas", async () => {
  for (let i = 0; i < 5; i++) {
    assert.ok(passes(await proxy(request("/api/v1/schools", { method: "OPTIONS", ip: "198.51.100.30" }), EVENT)));
  }
  const statuses: number[] = [];
  for (let i = 0; i < 61; i++) {
    const res = await proxy(request("/api/v1/schools", { ip: "198.51.100.30" }), EVENT);
    statuses.push(passes(res) ? 200 : (res as Response).status);
  }
  assert.equal(statuses.filter((s) => s === 200).length, 60);
  assert.equal(statuses[60], 429);
});
