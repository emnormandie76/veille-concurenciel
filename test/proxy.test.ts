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
 * Étape 2 (G5) : la première connexion (`/admin/first-login` et
 * `POST /api/first-login`) s'ajoute délibérément aux entrées libres. Sa route
 * n'est pas sous `/api/auth/*`, où tout devient public d'office.
 *
 * Il plafonne aussi l'API v1 (60 / min / IP, pour les requêtes connectées).
 * La connexion et la première connexion ne le sont plus ici : seuls leurs
 * échecs comptent, ce que le proxy ne voit pas (D117, lib/login-attempts.ts).
 *
 * Le matcher se teste avec `unstable_doesMiddlewareMatch` de
 * `next/experimental/testing/server`. La documentation de Next 16 cite
 * `unstable_doesProxyMatch`, que la version installée (16.4.2) n'exporte pas.
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

/** Les seules entrées libres : la connexion, la première connexion (étape 2) et NextAuth. */
const FREE = (url: string) =>
  url === "/admin/login" ||
  url === "/admin/first-login" ||
  url === "/api/first-login" ||
  url.startsWith("/api/auth/");

test("l'énumération voit les pages, les API et la connexion", () => {
  const urls = appUrls();
  for (const url of ["/", "/admin/login", "/admin/first-login", "/api/first-login", "/account", "/api-docs", "/schools/x-1", "/api/v1/schools", "/api/schools", "/api/auth/a/b", "/api/admin/inbox", "/api/admin/account"]) {
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

test("la connexion, la première connexion et NextAuth restent libres", async () => {
  for (const url of [
    "/admin/login",
    "/admin/login/",
    "/admin/first-login",
    "/admin/first-login/",
    "/api/first-login",
    "/api/auth/session",
    "/api/auth/csrf",
    "/api/auth/providers",
    "/api/auth/signout",
  ]) {
    assert.ok(passes(await proxy(request(url, { ip: "192.0.2.220" }), EVENT)), url);
  }
});

test("seules ces entrées sont libres : un voisin de la première connexion ne l'est pas", async () => {
  for (const url of ["/admin/first-login/x", "/api/first-login/x", "/api/first-loginx", "/admin/first-loginx", "/account", "/api/admin/account"]) {
    const res = await proxy(request(url, { ip: "192.0.2.221" }), EVENT);
    assert.equal(passes(res), false, url);
  }
});

// ── Avec session ─────────────────────────────────────────────────────

test("avec une session valide, quel que soit le rôle du jeton, la requête passe", async () => {
  for (const url of ["/", "/api-docs", "/schools/abc", "/api/schools", "/api/v1/schools", "/admin/cron", "/api/admin/inbox"]) {
    const res = await proxy(request(url, { cookie: validCookie, ip: "192.0.2.210" }), EVENT);
    assert.ok(passes(res), `${url} : statut ${res?.status}`);
  }
});

// ── Connexion : le proxy ne compte plus (D117) ───────────────────────
//
// Jusqu'au 23 octobre 2026, le proxy plafonnait la connexion et la première
// connexion à 5 envois par IP et par 15 minutes, réussites comprises :
// l'équipe sortant par une seule IP, la sixième connexion de l'école était
// refusée. D117 (le propriétaire) : seuls les échecs comptent, par compte et
// par IP. Le proxy ne voit pas l'issue d'une connexion : le plafond vit dans
// lib/login-attempts.ts (test/login-attempts.test.ts, test/sign-in.test.ts,
// test/api/first-login.test.ts). Les six tests de l'ancien plafond sont
// retirés avec la règle (le journal du plan les nomme).

test("D117 : le proxy laisse passer chaque envoi de connexion et de première connexion, sans compter", async () => {
  for (let i = 0; i < 10; i++) {
    const login = await proxy(request("/api/auth/callback/credentials", { method: "POST", ip: "203.0.113.10" }), EVENT);
    assert.ok(passes(login), `connexion n° ${i + 1} : statut ${login?.status}`);
    const first = await proxy(request("/api/first-login", { method: "POST", ip: "203.0.113.10" }), EVENT);
    assert.ok(passes(first), `première connexion n° ${i + 1} : statut ${first?.status}`);
  }
});

test("D117 : proxy.ts ne plafonne plus la connexion ; seule l'API v1 l'est encore", () => {
  const source = fs.readFileSync("proxy.ts", "utf8").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(source, /login:|LOGIN_LIMIT|PASSWORD_ENTRIES|callback\/credentials/);
  assert.equal(source.match(/checkRateLimit\(/g)?.length, 1, "un seul appel : l'API v1");
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
