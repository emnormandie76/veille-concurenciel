/**
 * test/pipeline-history.test.ts — L'historique des jobs de /admin/cron
 *
 *     npm run test:ts
 *
 * L'historique vient de `GET /api/admin/pipeline-jobs` (Prisma seul) : il
 * s'affiche en ligne comme en local. Ces tests tiennent ce que l'écran en dit :
 * origine, statut, durée, action en cours, et l'erreur d'un job en échec, en
 * aperçu de 300 caractères (décision du propriétaire du 14 octobre 2026).
 * Aussi le bandeau des contributions qui attendent le backend local, et,
 * depuis l'étape 7 du plan gestion-contenu, qui a lancé chaque job : son nom,
 * ou « non suivi » (D44).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  ERROR_PREVIEW_LENGTH,
  currentAction,
  describePendingAi,
  errorPreview,
  jobDuration,
  launcherLabel,
  sourceLabel,
  statusLabel,
  type PipelineJobRow,
} from "../lib/pipeline-history";

function job(overrides: Partial<PipelineJobRow> = {}): PipelineJobRow {
  return {
    id: "job-1",
    school_id: "school-1",
    school_name: "Em Lyon",
    phase: "Phase 2 — Enrichissement (Auto)",
    source: "rotation",
    status: "completed",
    progress: null,
    error: null,
    started_at: "2026-10-14T08:00:00.000Z",
    updated_at: "2026-10-14T09:05:00.000Z",
    finished_at: "2026-10-14T09:05:30.000Z",
    triggered_by: null,
    ...overrides,
  };
}

test("origine : manuelle, passe due, ancien cron", () => {
  assert.equal(sourceLabel("manual"), "manuelle");
  assert.equal(sourceLabel("rotation"), "passe due");
  assert.equal(sourceLabel("cron"), "ancien cron");
  assert.equal(sourceLabel("autre"), "autre");
});

test("statut : libellé et ton", () => {
  assert.deepEqual(statusLabel("queued"), { label: "en file", tone: "pending" });
  assert.deepEqual(statusLabel("running"), { label: "en cours", tone: "pending" });
  assert.deepEqual(statusLabel("completed"), { label: "terminé", tone: "ok" });
  assert.deepEqual(statusLabel("failed"), { label: "échec", tone: "error" });
  assert.deepEqual(statusLabel("bizarre"), { label: "bizarre", tone: "pending" });
});

test("durée : jusqu'à la fin, ou jusqu'à maintenant pour un job actif", () => {
  assert.equal(jobDuration(job(), 0), "1 h 05");
  assert.equal(jobDuration(job({ finished_at: "2026-10-14T08:00:45.000Z" }), 0), "45 s");
  assert.equal(jobDuration(job({ finished_at: "2026-10-14T08:12:10.000Z" }), 0), "12 min");
  const now = Date.parse("2026-10-14T08:03:00.000Z");
  assert.equal(jobDuration(job({ status: "running", finished_at: null }), now), "3 min");
  assert.equal(jobDuration(job({ started_at: "pas une date" }), now), "—");
});

test("action en cours, lue dans progress", () => {
  assert.equal(currentAction({ current_action: "Recherche Research", progress: "1/3" }), "Recherche Research");
  assert.equal(currentAction(null), null);
  assert.equal(currentAction({ current_action: 42 }), null);
  assert.equal(currentAction("texte"), null);
});

test("erreur d'un job : aperçu de 300 caractères, texte entier à part", () => {
  assert.equal(ERROR_PREVIEW_LENGTH, 300);
  assert.equal(errorPreview(null), null);
  assert.deepEqual(errorPreview("2 cible(s) en échec"), { short: "2 cible(s) en échec", truncated: false });

  const long = "x".repeat(1000);
  const preview = errorPreview(long);
  assert.ok(preview);
  assert.equal(preview.truncated, true);
  assert.equal(preview.short, `${"x".repeat(300)}…`);
});

test("contributions qui attendent le backend local", () => {
  assert.equal(describePendingAi(0), null);
  assert.equal(describePendingAi(1), "1 contribution attend le traitement par le backend local.");
  assert.equal(describePendingAi(4), "4 contributions attendent le traitement par le backend local.");
});

test("D44 : le lanceur, ou « non suivi » avec la raison au survol ; jamais de devinette", () => {
  assert.deepEqual(launcherLabel(job({ triggered_by: "Goat" })), { text: "Goat", tracked: true, hint: null });
  const untracked = launcherLabel(job());
  assert.equal(untracked.text, "non suivi");
  assert.equal(untracked.tracked, false);
  assert.match(untracked.hint ?? "", /avant le suivi des lancements/);
  assert.match(untracked.hint ?? "", /hors de cet écran/);
});

test("D43, D45 : l'historique de /admin/cron montre la colonne « Lancé par », dans la charte depuis l'étape 9 (lot 5)", () => {
  const screen = fs.readFileSync(path.join(process.cwd(), "app", "admin", "cron", "JobHistory.tsx"), "utf-8");
  assert.match(screen, /<Th>Origine<\/Th>\s*<Th>Lancé par<\/Th>/);
  assert.match(screen, /launcherLabel\(job\)/);
  // La bulle de « non suivi ».
  assert.match(screen, /title=\{launcher\.hint \?\? undefined\}/);
  // L'attendu change avec la règle : D45 gardait l'ancien style de l'écran
  // jusqu'à l'étape 9 ; au lot 5 (D54), le tableau est celui de la charte.
  assert.match(screen, /from "@\/components\/ui\/Table"/);
  assert.doesNotMatch(screen, /<style jsx>|className="admin-table/);
});
