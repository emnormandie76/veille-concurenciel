/**
 * test/proxy.test.ts — proxy.ts : connexion obligatoire et limitation de débit
 *
 *     npm run test:ts
 *
 * `proxy.ts` tient lieu de middleware dans Next 16. Plan gestion-contenu,
 * étape 1 (G6, piège 2) : une session est exigée sur **tout le site**, sauf la
 * page de connexion et `/api/auth/*` ; l'API v1, `/api/schools/*` et
 * `/api-docs` compris. Sans session, une page renvoie vers la connexion (avec
 * `callbackUrl`), une route `/api/*` répond 401 en JSON. Le proxy ne regarde
 * que l'existence d'une session valide : le rôle se contrôle côté serveur, dans
 * les gardes et les layouts (D1 ; test/auth.test.ts, test/api/access-matrix).
 *
 * Il plafonne aussi la connexion (5 tentatives / 15 min / IP) et l'API v1
 * (60 / min / IP, pour les requêtes connectées).
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
import fs from "node:fs";
import path from "node:path";
import { NextRequest, type NextFetchEvent } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { encode } from "next-auth/jwt";

const SECRET = "secret-de-test-du-proxy-jamais-utilise-ailleurs";
process.env.NEXTAUTH_SECRET = SECRET;
delete process.env.NEXTAUTH_URL;
delete process.env.VERCEL;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

type Proxy = (req: NextRequest, event: NextFetchEvent) => Promise<Response | undefined>;
let proxy: Proxy;
let config: { matcher: string[] };
let validCookie: string;

before(async () => {
  const mod = await import("../proxy");
  proxy = mod.default as unknown as Proxy;
  config = mod.config;
  const token = await encode({
    token: { id: "u-user", sub: "u-user", name: "utilisateur", role: "USER" },
    secret: SECRET,
  });
  validCookie = `next-auth.session-token=${token}`;
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

const runs = (url: string) => unstable_doesMiddlewareMatch({ config, url });

// ── Toutes les routes de app/ ────────────────────────────────────────

/**
 * Chaque page.tsx et route.ts de app/, en URL d'exemple : groupes de routes
 * retirés, segments dynamiques remplacés par une valeur.
 */
function appUrls(): string[] {
  const appDir = path.join(process.cwd(), "app");
  return fs
    .readdirSync(appDir, { recursive: true, encoding: "utf-8" })
    .filter((rel) => /^(page\.tsx|route\.ts)$/.test(path.basename(rel)))
    .map((rel) => {
      const segments = path
        .dirname(rel)
        .split(path.sep)
        .filter((s) => s !== "." && !/^\(.*\)$/.test(s))
        .map((s) => (s.startsWith("[...") ? "a/b" : s.startsWith("[") ? "x-1" : s));
      return `/${segments.join("/")}`;
    })
    .sort();
}

/** Les seules entrées libres : la connexion et NextAuth. */
const FREE = (url: string) => url === "/admin/login" || url.startsWith("/api/auth/");

test("l'énumération voit les pages, les API et la connexion", () => {
  const urls = appUrls();
  for (const url of ["/", "/admin/login", "/api-docs", "/schools/x-1", "/api/v1/schools", "/api/schools", "/api/auth/a/b", "/api/admin/inbox"]) {
    assert.ok(urls.includes(url), url);
  }
});

test("matcher : chaque page et chaque route de app/ passe par le proxy", () => {
  const missed = appUrls().filter((url) => !FREE(url) && !runs(url));
  assert.deepEqual(missed, []);
});

test("sans session, chaque page et chaque route de app/ est refusée, hors connexion et NextAuth", async () => {
  const open: string[] = [];
  for (const url of appUrls()) {
    const res = await proxy(request(url, { ip: "192.0.2.200" }), EVENT);
    if (FREE(url)) {
      if (!passes(res)) open.push(`${url} : la connexion doit rester libre (${res?.status})`);
    } else if (passes(res)) {
      open.push(`${url} : ouvert sans session`);
    }
  }
  assert.deepEqual(open, []);
});

test("matcher : les fichiers statiques et l'optimisation d'images n'y passent pas", () => {
  for (const url of ["/_next/static/chunks/main.js", "/_next/image?url=x", "/favicon.ico"]) {
    assert.equal(runs(url), false, url);
  }
  for (const url of ["/", "/api-docs", "/schools/abc", "/api/v1/schools", "/api/schools", "/admin/inbox", "/api/admin/inbox", "/contribute"]) {
    assert.equal(runs(url), true, url);
  }
});

// ── Sans session ─────────────────────────────────────────────────────

test("une page sans session → redirection vers /admin/login avec callbackUrl", async () => {
  for (const url of ["/", "/schools/abc/programs/def?onglet=tarifs", "/api-docs", "/admin/inbox?status=Pending_AI"]) {
    const res = await proxy(request(url), EVENT);
    assert.ok(res, url);
    assert.equal(res.status, 307, url);
    const location = new URL(res.headers.get("location") ?? "");
    assert.equal(location.pathname, "/admin/login", url);
    assert.equal(location.searchParams.get("callbackUrl"), url);
  }
});

test("une route /api/* sans session → 401 en JSON, sans redirection", async () => {
  for (const url of ["/api/v1/schools", "/api/schools", "/api/schools/abc", "/api/admin/inbox", "/api/contribute"]) {
    const res = await proxy(request(url, { ip: "192.0.2.201" }), EVENT);
    assert.equal(res?.status, 401, url);
    assert.equal(res?.headers.get("location"), null, url);
    assert.deepEqual(await res?.json(), { error: "Non authentifié. Veuillez vous connecter." });
  }
});

test("un pré-vol OPTIONS de l'API v1 sans session est refusé lui aussi", async () => {
  const res = await proxy(request("/api/v1/schools", { method: "OPTIONS", ip: "192.0.2.202" }), EVENT);
  assert.equal(res?.status, 401);
});

test("un jeton forgé avec un autre secret ne vaut pas session", async () => {
  const token = await encode({ token: { id: "u-admin", sub: "u-admin", role: "ADMIN" }, secret: "un-autre-secret" });
  const cookie = `next-auth.session-token=${token}`;

  assert.equal((await proxy(request("/admin/cron", { cookie }), EVENT))?.status, 307);
  assert.equal((await proxy(request("/", { cookie }), EVENT))?.status, 307);
  assert.equal((await proxy(request("/api/v1/schools", { cookie, ip: "192.0.2.203" }), EVENT))?.status, 401);
});

test("la connexion et NextAuth restent libres", async () => {
  for (const url of ["/admin/login", "/admin/login/", "/api/auth/session", "/api/auth/csrf", "/api/auth/providers", "/api/auth/signout"]) {
    assert.ok(passes(await proxy(request(url), EVENT)), url);
  }
});

// ── Avec session ─────────────────────────────────────────────────────

test("avec une session valide, quel que soit le rôle du jeton, la requête passe", async () => {
  for (const url of ["/", "/api-docs", "/schools/abc", "/api/schools", "/api/v1/schools", "/admin/cron", "/api/admin/inbox"]) {
    const res = await proxy(request(url, { cookie: validCookie, ip: "192.0.2.210" }), EVENT);
    assert.ok(passes(res), `${url} : statut ${res?.status}`);
  }
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

// ── API v1 : le plafond reste ────────────────────────────────────────

test("/api/v1 connecté : 60 par minute et par IP, la 61ᵉ → 429 ; les pré-vols OPTIONS ne comptent pas", async () => {
  const ip = "198.51.100.30";
  for (let i = 0; i < 5; i++) {
    assert.ok(passes(await proxy(request("/api/v1/schools", { method: "OPTIONS", ip, cookie: validCookie }), EVENT)));
  }
  const statuses: number[] = [];
  for (let i = 0; i < 61; i++) {
    const res = await proxy(request("/api/v1/schools", { ip, cookie: validCookie }), EVENT);
    statuses.push(passes(res) ? 200 : (res as Response).status);
  }
  assert.equal(statuses.filter((s) => s === 200).length, 60);
  assert.equal(statuses[60], 429);
});

test("/api/v1 : les appels sans session ne consomment pas le quota de l'IP", async () => {
  const ip = "198.51.100.31";
  for (let i = 0; i < 80; i++) {
    assert.equal((await proxy(request("/api/v1/schools", { ip }), EVENT))?.status, 401);
  }
  assert.ok(passes(await proxy(request("/api/v1/schools", { ip, cookie: validCookie }), EVENT)));
});
