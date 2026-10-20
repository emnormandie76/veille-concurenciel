/**
 * test/smoke-checks.test.ts — Les règles du smoke local (scripts/lib/smoke-checks.ts)
 *
 *     npm run test:ts
 *
 * Le smoke lui-même (`npm run smoke`) a besoin de `npm run dev` et de la base :
 * il ne tourne pas en CI. Ses règles, si : quoi appeler, et comment juger.
 *
 * Plan gestion-contenu, étape 1 : le site exige une session. Le smoke joue
 * d'abord le mur (sans session : renvoi vers la connexion, 401 sur les API),
 * puis, s'il peut se connecter, les pages et l'API avec la session.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  buildChecks,
  buildWallChecks,
  cookieHeader,
  judge,
  judgeWall,
  localBaseUrl,
  nextErrorMarker,
  PAGES,
  smokeCredentials,
  V1_ROUTES,
} from "../scripts/lib/smoke-checks";

const IDS = { schoolId: "school-1", programId: "program-1", campusId: "campus-1" };

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

test("V1_ROUTES est exactement l'ensemble des routes de app/api/v1", () => {
  const root = path.join(process.cwd(), "app");
  const onDisk = routeFiles(path.join(root, "api", "v1"))
    .map((file) => "/" + path.relative(root, path.dirname(file)).split(path.sep).join("/"))
    .sort();
  assert.deepEqual([...V1_ROUTES].sort(), onDisk);
  assert.equal(V1_ROUTES.length, 15);
});

test("chaque page appelée existe dans app/", () => {
  for (const page of PAGES) {
    const file = path.join(process.cwd(), "app", ...page.split("/").filter(Boolean), "page.tsx");
    assert.ok(fs.existsSync(file), `${page} → ${file}`);
  }
});

test("buildChecks : identifiants posés selon le préfixe, comparaison avec ?ids", () => {
  const paths = buildChecks(IDS).map((c) => c.path);

  assert.equal(paths.length, PAGES.length + V1_ROUTES.length);
  for (const expected of [
    "/schools/school-1",
    "/schools/school-1/programs/program-1",
    "/api/v1/schools/school-1/pricing",
    "/api/v1/programs/program-1/capacity",
    "/api/v1/campuses/campus-1",
    "/api/v1/compare/programs?ids=program-1",
  ]) {
    assert.ok(paths.includes(expected), expected);
  }
  assert.ok(paths.every((p) => p !== null && !p.includes("[")), "aucun gabarit laissé tel quel");
});

test("buildChecks : sans campus, /campuses/[id] est sauté ; /stats tolère l'absence", () => {
  const checks = buildChecks({ ...IDS, campusId: null });

  const campus = checks.find((c) => c.route === "/api/v1/campuses/[id]")!;
  assert.equal(campus.path, null);
  assert.match(campus.skipped!, /aucun campus/);
  assert.equal(checks.filter((c) => c.missingOk).map((c) => c.route).join(), "/api/v1/schools/[id]/stats");
});

test("localBaseUrl : le poste seulement", () => {
  for (const ok of ["http://localhost:3000", "http://127.0.0.1:3001/", "http://[::1]:3000"]) {
    assert.equal(localBaseUrl(ok).protocol, "http:", ok);
  }
  for (const refused of [
    "https://vc-bdd.vercel.app",
    "http://192.168.1.20:3000",
    "http://localhost.evil.com",
    "ftp://localhost",
    "pas une adresse",
  ]) {
    assert.throws(() => localBaseUrl(refused), /refusée|illisible/, refused);
  }
});

test("nextErrorMarker : pages d'erreur et rendus en échec, pas les reports au navigateur", () => {
  assert.match(nextErrorMarker('<html id="__next_error__"><body></body></html>')!, /__next_error__/);
  assert.match(nextErrorMarker('<template data-next-error-digest="123"></template>')!, /data-next-error-digest/);
  assert.match(nextErrorMarker("<h2>This page could not be found.</h2>")!, /404/);
  assert.match(nextErrorMarker('<template data-dgst="2861483951"></template>')!, /digest 2861483951/);
  assert.equal(nextErrorMarker('<template data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING"></template>'), null);
  assert.equal(nextErrorMarker("<html><body><h1>Écoles</h1></body></html>"), null);
});

// next dev 16.3.8 sérialise la frontière not-found par défaut dans la charge RSC
// de chaque page (relevé le 15 octobre 2026 sur `/`, `/contribute`, `/api-docs`
// et les deux fiches, toutes en HTTP 200). Une vraie 404 porte la phrase dans
// le balisage, hors <script>.
const RSC_NOT_FOUND =
  '<script>self.__next_f.push([1,"20:[[\\"$\\",\\"title\\",null,{\\"children\\":\\"404: This page could not be found.\\"},\\"$23\\"]]\\n"])</script>';

test("nextErrorMarker : la phrase 404 dans la charge RSC d'une page saine n'est pas une page 404", () => {
  assert.equal(nextErrorMarker(`<html><head><title>Écoles</title></head><body><h1>Écoles</h1>${RSC_NOT_FOUND}</body></html>`), null);
  assert.equal(nextErrorMarker(`<html><body><script type="text/javascript">"This page could not be found"</script></body></html>`), null);
  // Une vraie page 404 : la phrase est aussi dans le balisage.
  assert.match(
    nextErrorMarker(`<html><head><title>404: This page could not be found.</title></head><body>${RSC_NOT_FOUND}</body></html>`)!,
    /404/
  );
});

test("judge : API — 200 et JSON lisible ; 404 de /stats « absent » ; le reste en échec", () => {
  const api = buildChecks(IDS).find((c) => c.route === "/api/v1/rankings")!;
  const stats = buildChecks(IDS).find((c) => c.route === "/api/v1/schools/[id]/stats")!;
  const json = (status: number, body: unknown) => ({ status, contentType: "application/json", text: JSON.stringify(body) });

  assert.deepEqual(judge(api, json(200, { data: [] })), { outcome: "ok" });
  assert.equal(judge(api, { status: 200, contentType: "text/html", text: "<html>" }).outcome, "fail");
  assert.deepEqual(judge(api, json(500, { error: "Erreur serveur interne" })), {
    outcome: "fail",
    detail: "HTTP 500 : Erreur serveur interne",
  });
  assert.deepEqual(judge(stats, json(404, { error: "Statistiques introuvables" })), {
    outcome: "absent",
    detail: "Statistiques introuvables",
  });
  assert.equal(judge(stats, json(404, { error: "École introuvable" })).outcome, "fail");
  assert.equal(judge(api, json(404, { error: "Statistiques introuvables" })).outcome, "fail");
});

test("judge : page — 200, HTML, sans marque d'erreur", () => {
  const page = buildChecks(IDS).find((c) => c.route === "/")!;
  const html = (status: number, text: string, contentType = "text/html; charset=utf-8") => ({ status, contentType, text });

  assert.deepEqual(judge(page, html(200, "<html><body>Écoles</body></html>")), { outcome: "ok" });
  assert.deepEqual(judge(page, html(200, `<html><body>Écoles${RSC_NOT_FOUND}</body></html>`)), { outcome: "ok" });
  assert.deepEqual(judge(page, html(404, `<html><body>${RSC_NOT_FOUND}</body></html>`)), { outcome: "fail", detail: "HTTP 404" });
  assert.deepEqual(judge(page, html(500, "<html>")), { outcome: "fail", detail: "HTTP 500" });
  assert.equal(judge(page, html(200, '<html id="__next_error__">')).outcome, "fail");
  assert.equal(judge(page, html(200, "{}", "application/json")).outcome, "fail");
});

// ── Le mur : sans session ────────────────────────────────────────────

test("PAGES : la contribution n'en fait plus partie (D2) ; « Mon compte » y entre (étape 2)", () => {
  assert.equal((PAGES as readonly string[]).includes("/contribute"), false);
  assert.equal((PAGES as readonly string[]).includes("/account"), true);
  assert.equal((PAGES as readonly string[]).includes("/schools/[id]/report"), true, "le signalement (étape 6)");
});

test("buildWallChecks : la connexion, chaque page, le back-office, /api/schools et les 15 routes v1", () => {
  const checks = buildWallChecks();
  const byPath = new Map(checks.map((c) => [c.path, c.expect]));

  assert.equal(byPath.get("/admin/login"), "open");
  // Étape 2 : la première connexion est ouverte, « Mon compte » ne l'est pas.
  assert.equal(byPath.get("/admin/first-login"), "open");
  assert.equal(checks.filter((c) => c.expect === "open").length, 2);
  for (const page of ["/", "/api-docs", "/admin/schools", "/account"]) assert.equal(byPath.get(page), "redirect", page);
  assert.ok(checks.some((c) => c.expect === "redirect" && c.path.startsWith("/schools/")));
  assert.equal(byPath.get("/api/schools"), "unauthorized");
  assert.equal(checks.filter((c) => c.path.startsWith("/api/v1/")).length, V1_ROUTES.length);
  assert.ok(checks.filter((c) => c.path.startsWith("/api/")).every((c) => c.expect === "unauthorized"));
  assert.ok(checks.every((c) => !c.path.includes("[")), "aucun gabarit laissé tel quel");
});

test("judgeWall : une page doit renvoyer vers la connexion, avec son chemin en callbackUrl", () => {
  const page = buildWallChecks().find((c) => c.path === "/api-docs")!;
  const redirect = (status: number, location: string | null) => ({ status, contentType: "", text: "", location });

  assert.deepEqual(judgeWall(page, redirect(307, "/admin/login?callbackUrl=%2Fapi-docs")), { outcome: "ok" });
  assert.deepEqual(judgeWall(page, redirect(307, "http://localhost:3000/admin/login?callbackUrl=%2Fapi-docs")), { outcome: "ok" });
  assert.equal(judgeWall(page, redirect(200, null)).outcome, "fail");
  assert.equal(judgeWall(page, redirect(307, "/autre?callbackUrl=%2Fapi-docs")).outcome, "fail");
  assert.equal(judgeWall(page, redirect(307, "/admin/login?callbackUrl=%2F")).outcome, "fail");
});

test("judgeWall : une API doit répondre 401 en JSON, sans données", () => {
  const api = buildWallChecks().find((c) => c.path === "/api/v1/schools")!;
  const json = (status: number, body: unknown) => ({ status, contentType: "application/json", text: JSON.stringify(body), location: null });

  assert.deepEqual(judgeWall(api, json(401, { error: "Non authentifié. Veuillez vous connecter." })), { outcome: "ok" });
  assert.deepEqual(judgeWall(api, json(200, { data: [] })), { outcome: "fail", detail: "HTTP 200 : ouvert sans session" });
  assert.equal(judgeWall(api, { status: 307, contentType: "", text: "", location: "/admin/login" }).outcome, "fail");
});

test("judgeWall : la page de connexion reste ouverte et saine", () => {
  const login = buildWallChecks().find((c) => c.path === "/admin/login")!;
  const html = (status: number, text: string) => ({ status, contentType: "text/html; charset=utf-8", text, location: null });

  assert.deepEqual(judgeWall(login, html(200, "<html><body>Se connecter</body></html>")), { outcome: "ok" });
  assert.equal(judgeWall(login, html(307, "")).outcome, "fail");
  assert.equal(judgeWall(login, html(200, '<html id="__next_error__">')).outcome, "fail");
});

// ── La session : les cookies de NextAuth ─────────────────────────────

test("cookieHeader : les paires nom=valeur des Set-Cookie, sans leurs attributs", () => {
  assert.equal(
    cookieHeader([
      "next-auth.csrf-token=abc%7Cdef; Path=/; HttpOnly; SameSite=Lax",
      "next-auth.callback-url=http%3A%2F%2Flocalhost%3A3000; Path=/; SameSite=Lax",
    ]),
    "next-auth.csrf-token=abc%7Cdef; next-auth.callback-url=http%3A%2F%2Flocalhost%3A3000"
  );
  assert.equal(cookieHeader([]), "");
});

test("cookieHeader : un cookie effacé (valeur vide) n'est pas repris", () => {
  assert.equal(
    cookieHeader(["next-auth.session-token=; Path=/; Max-Age=0", "a=b; Path=/"]),
    "a=b"
  );
});

// ── Les identifiants du smoke (étape 2, D3) ──────────────────────────

test("smokeCredentials : l'adresse d'abord, l'ancien identifiant tant qu'il n'y a pas d'adresse", () => {
  const password = "valeur-de-test-jamais-affichee";
  assert.deepEqual(
    smokeCredentials({ APPVC_ADMIN_EMAIL: "admin@em-normandie.fr", APPVC_ADMIN_USERNAME: "admin", APPVC_ADMIN_PASSWORD: password }),
    { login: "admin@em-normandie.fr", password, from: "APPVC_ADMIN_EMAIL" }
  );
  assert.deepEqual(smokeCredentials({ APPVC_ADMIN_USERNAME: "admin", APPVC_ADMIN_PASSWORD: password }), {
    login: "admin",
    password,
    from: "APPVC_ADMIN_USERNAME",
  });
  assert.deepEqual(smokeCredentials({ APPVC_ADMIN_EMAIL: "", APPVC_ADMIN_USERNAME: "admin", APPVC_ADMIN_PASSWORD: password })?.from, "APPVC_ADMIN_USERNAME");
});

test("smokeCredentials : sans mot de passe ou sans identifiant, la phase connectée est sautée", () => {
  for (const env of [
    {},
    { APPVC_ADMIN_EMAIL: "admin@em-normandie.fr" },
    { APPVC_ADMIN_PASSWORD: "x" },
    { APPVC_ADMIN_EMAIL: "", APPVC_ADMIN_USERNAME: "", APPVC_ADMIN_PASSWORD: "x" },
    { APPVC_ADMIN_USERNAME: "admin", APPVC_ADMIN_PASSWORD: "" },
  ]) {
    assert.equal(smokeCredentials(env), null, JSON.stringify(Object.keys(env)));
  }
});
