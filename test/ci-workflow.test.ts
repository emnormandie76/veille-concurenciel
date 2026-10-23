/**
 * test/ci-workflow.test.ts — La base de CI éphémère
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 15 (mémo Vercel §11) : le job `validate` joue
 * toutes les migrations sur un Postgres jetable, créé pour le run, sur
 * toutes les branches. Jusque-là, `prisma migrate status` interrogeait la
 * base Neon des secrets (la production, `ep-super-rain`) et ne bloquait que
 * sur `main` : personne ne vérifiait qu'une migration s'applique sur une
 * base vierge. Le contrôle contre Neon reste, sur `main` seul (D121).
 *
 * Ce test lit le workflow ; qu'une migration cassée fasse vraiment échouer
 * le job ne se voit qu'en CI (le port 5432 est fermé sur le poste) : une
 * branche d'essai l'a montré (D122, journal du plan).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ci = readFileSync(".github/workflows/ci.yml", "utf8").replace(/\r/g, "");
const validate = ci.slice(ci.indexOf("\n  validate:"), ci.indexOf("\n  ts-tests:"));
const jobHead = validate.slice(0, validate.indexOf("\n    steps:"));
const steps = validate
  .split(/\n      - name: /)
  .slice(1)
  .map((block) => ({ name: block.split("\n")[0], body: block }));
const step = (name: string) => {
  const found = steps.filter((s) => s.name.includes(name));
  assert.equal(found.length, 1, name);
  return found[0];
};

const EPHEMERAL = '"postgresql://ci:ci@127.0.0.1:5432/ci"';

test("le job validate a son Postgres jetable, de la version de Neon (18), prêt avant les étapes", () => {
  assert.match(jobHead, /\n    services:\n      postgres:\n        image: postgres:18\n/);
  assert.match(jobHead, /- 5432:5432/);
  assert.match(jobHead, /--health-cmd "pg_isready/);
});

test("piège 1 : DATABASE_URL et DIRECT_URL du job visent toutes deux la base jetable, jamais un secret", () => {
  // prisma.config.ts préfère DIRECT_URL pour migrer : la laisser sur Neon y enverrait les migrations.
  assert.ok(jobHead.includes(`DATABASE_URL: ${EPHEMERAL}`));
  assert.ok(jobHead.includes(`DIRECT_URL: ${EPHEMERAL}`));
  assert.doesNotMatch(jobHead, /secrets\.(DATABASE_URL|DIRECT_URL)/);
});

test("sur toutes les branches : les migrations jouées sur la base vierge, puis leur statut, sans échec toléré", () => {
  const deploy = step("migrations sur une base vierge");
  const status = step("statut des migrations (base jetable)");
  assert.match(deploy.body, /\n        run: npx prisma migrate deploy\n/);
  assert.match(status.body, /\n        run: npx prisma migrate status\n/);
  assert.ok(steps.indexOf(deploy) < steps.indexOf(status));
  for (const s of [deploy, status]) {
    assert.doesNotMatch(s.body, /\n        (if|continue-on-error|env):/, s.name);
  }
});

test("D121 : le statut contre Neon, sur main et les PR vers main seulement ; les secrets Neon ne servent qu'à lui", () => {
  const neon = step("statut des migrations (base de production)");
  assert.match(neon.body, /\n        if: github\.ref == 'refs\/heads\/main' \|\| github\.base_ref == 'main'\n/);
  assert.match(neon.body, /\n          DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}\n/);
  assert.match(neon.body, /\n          DIRECT_URL: \$\{\{ secrets\.DIRECT_URL \}\}\n/);
  assert.match(neon.body, /\n        run: npx prisma migrate status\n/);
  assert.doesNotMatch(neon.body, /continue-on-error/);
  assert.equal(ci.split("secrets.DATABASE_URL").length - 1, 1);
  assert.equal(ci.split("secrets.DIRECT_URL").length - 1, 1);
});

test("aucune étape ne migre la base des secrets, ni ne synchronise le schéma sans migration", () => {
  assert.equal(ci.split("run: npx prisma migrate deploy").length - 1, 1);
  assert.doesNotMatch(ci, /prisma db push|migrate (dev|reset)/);
});
