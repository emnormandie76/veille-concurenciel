/**
 * test/no-public-tickets.test.ts — Next.js ne crée plus de ticket dans l'inbox
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 1, décision D2 : la contribution du public est
 * retirée (`/contribute`, `/api/contribute`). C'était le seul chemin web qui
 * créait des tickets `Pending_AI`, que le backend gelé paie dès son lancement
 * (piège 6, règle 7 de CLAUDE.md). Ce test garde la porte fermée : aucun
 * fichier de app/ ni de lib/ ne crée de ticket `ContributionInbox` ; seul le
 * backend Python en écrit.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  return fs
    .readdirSync(path.join(ROOT, dir), { recursive: true, encoding: "utf-8" })
    .filter((rel) => /\.tsx?$/.test(rel))
    .map((rel) => path.join(dir, rel).split(path.sep).join("/"));
}

test("D2 : la page et la route de contribution n'existent plus", () => {
  assert.equal(fs.existsSync(path.join(ROOT, "app", "contribute")), false);
  assert.equal(fs.existsSync(path.join(ROOT, "app", "api", "contribute")), false);
});

test("piège 6 : aucun fichier de app/ ni de lib/ ne crée de ticket ContributionInbox", () => {
  const writers = [...sourceFiles("app"), ...sourceFiles("lib")].filter((file) =>
    /contributionInbox\s*\.\s*(create|createMany|upsert)\b/.test(fs.readFileSync(path.join(ROOT, file), "utf-8"))
  );
  assert.deepEqual(writers, []);
});

test("plus aucun lien vers /contribute", () => {
  const links = [...sourceFiles("app"), ...sourceFiles("lib")].filter((file) =>
    /["'`]\/contribute\b/.test(fs.readFileSync(path.join(ROOT, file), "utf-8"))
  );
  assert.deepEqual(links, []);
});
