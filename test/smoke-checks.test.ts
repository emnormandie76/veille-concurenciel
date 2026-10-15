/**
 * test/smoke-checks.test.ts — Les règles du smoke local (scripts/lib/smoke-checks.ts)
 *
 *     npm run test:ts
 *
 * Le smoke lui-même (`npm run smoke`) a besoin de `npm run dev` et de la base :
 * il ne tourne pas en CI. Ses règles, si : quoi appeler, et comment juger.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { buildChecks, judge, localBaseUrl, nextErrorMarker, PAGES, V1_ROUTES } from "../scripts/lib/smoke-checks";

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
  assert.deepEqual(judge(page, html(500, "<html>")), { outcome: "fail", detail: "HTTP 500" });
  assert.equal(judge(page, html(200, '<html id="__next_error__">')).outcome, "fail");
  assert.equal(judge(page, html(200, "{}", "application/json")).outcome, "fail");
});
