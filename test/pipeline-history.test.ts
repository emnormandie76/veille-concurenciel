/**
 * test/pipeline-history.test.ts — Le bandeau des contributions qui attendent le backend local
 *
 *     npm run test:ts
 *
 * L'inbox affiche ce bandeau quand des contributions `Pending_AI` attendent le
 * backend, lancé sur le poste de l'admin. Les tests de l'historique des jobs
 * de /admin/cron (origine, statut, durée, action en cours, erreur, lanceur,
 * D43 à D45) sont partis avec la console sur la branche `local` (étape 11 du
 * plan gestion-contenu, D100).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { describePendingAi } from "../lib/pipeline-history";

test("contributions qui attendent le backend local", () => {
  assert.equal(describePendingAi(0), null);
  assert.equal(describePendingAi(1), "1 contribution attend le traitement par le backend local.");
  assert.equal(describePendingAi(4), "4 contributions attendent le traitement par le backend local.");
});
