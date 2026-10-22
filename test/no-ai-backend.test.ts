/**
 * test/no-ai-backend.test.ts — Cette branche ne pilote plus l'IA et ne peut rien dépenser
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 11. La console IA (`/admin/cron`) et ses routes
 * vivent sur la branche `local`, avec le backend Python (D100) ; `gestion` et
 * `main` les ont perdus (D101). L'inbox reste, avec la validation des tickets
 * IA. Sur cette branche, plus aucune commande ne lance le backend, et donc ne
 * paie Tavily ni Gemini (règle 7 de CLAUDE.md, qui reste vraie sur `local`).
 *
 * Un correctif de `local` se reporte ici par `cherry-pick` : ce test dit tout
 * de suite s'il ramène la console, un appel au backend ou une commande qui le
 * lance. `npm test` lance les tests TypeScript (D105).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const exists = (...parts: string[]) => fs.existsSync(path.join(ROOT, ...parts));

/** Les fichiers TypeScript d'un dossier, récursivement, en chemins relatifs. */
function sources(dir: string): string[] {
  return fs
    .readdirSync(path.join(ROOT, dir), { recursive: true, encoding: "utf-8" })
    .filter((rel) => /\.tsx?$/.test(rel))
    .map((rel) => path.join(dir, rel).split(path.sep).join("/"));
}

const CODE = [...sources("app"), ...sources("lib"), ...sources("components"), ...sources("scripts"), "proxy.ts"];
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8");

/** Les routes de la console, sous app/api/admin (D100). */
const CONSOLE_ROUTES = ["pipeline-status", "pipeline-jobs", "trigger-research", "run-due-passes", "schools-with-programs"];

test("D100 : ni la console ni ses routes ne sont sur cette branche", () => {
  assert.equal(exists("app", "admin", "cron"), false, "app/admin/cron");
  for (const route of CONSOLE_ROUTES) assert.equal(exists("app", "api", "admin", route), false, route);
});

test("D100 : aucun lien ni appel vers la console ou ses routes", () => {
  const target = new RegExp(`["']/(admin/cron|api/admin/(${CONSOLE_ROUTES.join("|")}))\\b`);
  assert.deepEqual(
    CODE.filter((rel) => target.test(read(rel))),
    []
  );
});

test("D101 : aucun code ne joint le backend (ni son adresse ni son jeton)", () => {
  const backend = /\b(FASTAPI_URL|INTERNAL_API_TOKEN|FASTAPI_INTERNAL_TOKEN|INTERNAL_TOKEN)\b/;
  assert.deepEqual(
    CODE.filter((rel) => backend.test(read(rel))),
    []
  );
});

test("D101, D105 : aucune commande ne lance le backend ; npm test lance les tests TypeScript", () => {
  const { scripts } = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  assert.equal("backend" in scripts, false, "npm run backend");
  assert.equal("local" in scripts, false, "npm run local");
  assert.equal(scripts.test, "npm run test:ts");
  for (const [name, command] of Object.entries(scripts)) {
    assert.equal(/uvicorn|pytest|python|start-local|backend\//i.test(command), false, `${name} : ${command}`);
  }
  assert.equal(exists("scripts", "start-local.ps1"), false, "scripts/start-local.ps1");
  assert.equal(exists("pytest.ini"), false, "pytest.ini");
});

test("D101 : la CI n'a plus de job Python", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.equal(/python|pytest|requirements/i.test(ci), false);
});
