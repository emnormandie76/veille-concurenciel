/**
 * test/local-launcher.test.ts — Le lanceur local : npm run backend, npm run local
 *
 *     npm run test:ts
 *
 * Plan backend-local, étape 6. Le backend n'est plus hébergé : l'admin le lance
 * sur son poste, avec `npm run local` (scripts/start-local.ps1) ou
 * `npm run backend`. Analyse statique, sans rien lancer : le script PowerShell
 * ne tourne que sous Windows, et lancer le backend peut payer (contributions
 * `Pending_AI`). Le test vérifie que :
 * - le backend n'écoute que sur 127.0.0.1, jamais sur 0.0.0.0 (architecture.md
 *   §10.6) ;
 * - `npm run backend` et le lanceur lancent la même commande ;
 * - le chemin de l'interpréteur est entre guillemets : sans eux, `cmd.exe`, le
 *   shell des scripts npm sous Windows, lit `backend/.venv/…` comme
 *   « backend » suivi d'une option ;
 * - le lanceur commence par un BOM UTF-8 : sans lui, Windows PowerShell 5.1
 *   lit le fichier en ANSI et ses messages en français arrivent abîmés ;
 * - l'écran cite une commande qui existe.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { LOCAL_BACKEND_COMMAND } from "../lib/backend-state";

const ROOT = process.cwd();
const LAUNCHER = path.join(ROOT, "scripts", "start-local.ps1");

const scripts: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
).scripts;
const launcherBytes = fs.readFileSync(LAUNCHER);
const launcher = launcherBytes.toString("utf8");

/** Les arguments d'uvicorn tels que le lanceur les déclare. */
function launcherUvicornArgs(): string {
  const match = launcher.match(/^\$UvicornArgs = '([^']+)'/m);
  assert.ok(match, "scripts/start-local.ps1 déclare $UvicornArgs sur une ligne");
  return match[1];
}

test("npm run backend : uvicorn sur 127.0.0.1:8000, interpréteur du venv entre guillemets", () => {
  assert.equal(
    scripts.backend,
    '"backend/.venv/Scripts/python" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000',
  );
});

test("le lanceur et npm run backend lancent la même commande", () => {
  assert.equal(scripts.backend, `"backend/.venv/Scripts/python" ${launcherUvicornArgs()}`);
  assert.match(launcher, /^\$BackendHost = '127\.0\.0\.1'$/m);
  assert.match(launcher, /^\$BackendPort = 8000$/m);
});

test("jamais 0.0.0.0, ni --reload", () => {
  for (const [name, text] of [
    ["npm run backend", scripts.backend],
    ["scripts/start-local.ps1", launcher],
  ]) {
    assert.doesNotMatch(text, /0\.0\.0\.0/, `${name} ne doit pas écouter sur toutes les interfaces`);
  }
  // --reload relance le processus dès qu'un fichier change : une passe en
  // cours serait tuée, et son job laissé « running ».
  assert.doesNotMatch(scripts.backend, /--reload/);
  assert.doesNotMatch(launcherUvicornArgs(), /--reload/);
});

test("npm run local lance scripts/start-local.ps1 sous Windows PowerShell", () => {
  assert.equal(
    scripts.local,
    "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1",
  );
});

test("le lanceur commence par un BOM UTF-8 (Windows PowerShell 5.1)", () => {
  assert.deepEqual([...launcherBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test("l'écran « backend local non lancé » cite npm run local, qui existe", () => {
  assert.equal(LOCAL_BACKEND_COMMAND, "npm run local");
  assert.ok(scripts.local, "package.json déclare le script local");
});
