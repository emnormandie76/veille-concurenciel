/**
 * test/rotation-status.test.ts — Le panneau « Passes dues » de /admin/cron
 *
 *     npm run test:ts
 *
 * Le bloc vient de `GET /internal/pipeline-status` (`scheduler.rotation`) ; la
 * suite Python tient sa forme (test_rotation_status.py). Depuis l'étape 3 du
 * plan backend-local, il n'y a plus de cron : ni nuit, ni heure, ni fuseau. Les
 * passes partent sur demande, sous le plafond mensuel, après une synchro
 * `/usage`. Ces tests tiennent ce que le panneau en dit, le corps envoyé à
 * `POST /api/admin/run-due-passes` et la lecture de son rapport.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_PASSES_PER_RUN,
  ceilingUsage,
  describeDuePassesReport,
  describeRotation,
  describeUsageSync,
  fitsUnderCeiling,
  formatPassDate,
  isRotationError,
  parseRunDuePassesBody,
  previewRun,
  rotationMode,
  type DuePassesReport,
  type RotationCandidate,
  type RotationStatus,
} from "../lib/rotation-status";

const LYON_P2: RotationCandidate = {
  school_name: "Em Lyon",
  phase: "2",
  reason: "interval",
  last_pass_at: "2026-03-01T03:12:00+00:00",
  estimated_credits: 785,
};

const NEOMA_P1: RotationCandidate = {
  school_name: "Neoma",
  phase: "1",
  reason: "never",
  last_pass_at: null,
  estimated_credits: 30,
};

const SYNC_OK = { ok: true, at: "2026-10-14T08:00:00+00:00", failed_keys: [] };

function rotation(overrides: Partial<RotationStatus> = {}): RotationStatus {
  return {
    interval_days: 182,
    monthly_ceiling: 7000,
    month_credits_used: 1240,
    due_count: 2,
    next: [LYON_P2, NEOMA_P1],
    last_run: null,
    usage_sync: SYNC_OK,
    ...overrides,
  };
}

function report(overrides: Partial<DuePassesReport> = {}): DuePassesReport {
  return {
    dry_run: false,
    max_passes: 1,
    status: "planned",
    detail: "1 passe(s) au départ : Em Lyon, Phase 2, ~785 crédits",
    monthly_ceiling: 7000,
    month_credits_used: 1240,
    due_count: 2,
    planned: [LYON_P2],
    launched: [],
    usage_sync: SYNC_OK,
    ...overrides,
  };
}

test("sur demande : ni nuit, ni heure, ni fuseau ; le rythme et le plafond se lisent", () => {
  const text = describeRotation(rotation());
  assert.equal(rotationMode(rotation()), "on_demand");
  assert.equal(text, "Sur demande — retour tous les 182 jours, plafond de 7000 crédits par mois");
  assert.doesNotMatch(text, /nuit|heure|Europe\/Paris/);
});

test("plafond à 0 : aucune passe ne tient, seule la simulation sert", () => {
  const zero = rotation({ monthly_ceiling: 0 });
  assert.equal(rotationMode(zero), "ceiling_zero");
  assert.match(describeRotation(zero), /^Plafond à 0 — aucune passe ne tient/);
});

test("synchro /usage : réussie, en échec, ou jamais faite depuis le démarrage", () => {
  const ok = describeUsageSync(SYNC_OK);
  assert.equal(ok.tone, "ok");
  assert.match(ok.text, /recalés sur Tavily/);

  const failed = describeUsageSync({ ok: false, at: SYNC_OK.at, failed_keys: ["...abc123", "...def456"] });
  assert.equal(failed.tone, "warning");
  assert.match(failed.text, /\.\.\.abc123, \.\.\.def456/);
  assert.match(failed.text, /ne part pas/);

  const never = describeUsageSync(null);
  assert.equal(never.tone, "warning");
  assert.match(never.text, /non recalés/);
});

test("une passe tient sous le plafond selon la règle du backend", () => {
  assert.equal(fitsUnderCeiling(LYON_P2, rotation({ month_credits_used: 6215 })), true);
  assert.equal(fitsUnderCeiling(LYON_P2, rotation({ month_credits_used: 6216 })), false);
  assert.equal(fitsUnderCeiling(LYON_P2, rotation({ monthly_ceiling: 0, month_credits_used: 0 })), false);
  assert.equal(fitsUnderCeiling(LYON_P2, rotation({ month_credits_used: null })), null);
});

test("aperçu d'un lancement : la même sélection que le backend, sur les passes affichées", () => {
  // Les deux tiennent : 1240 + 785 + 30 ≤ 7000.
  assert.deepEqual(previewRun(rotation(), 5), { passes: [LYON_P2, NEOMA_P1], credits: 815 });
  assert.deepEqual(previewRun(rotation(), 1), { passes: [LYON_P2], credits: 785 });
  // Em Lyon ne tient plus ; Neoma, si : le backend la prend à sa place.
  assert.deepEqual(previewRun(rotation({ month_credits_used: 6500 }), 1), { passes: [NEOMA_P1], credits: 30 });
  // Chaque passe retenue compte : la seconde ne tient plus après la première.
  assert.deepEqual(
    previewRun(rotation({ month_credits_used: 6200, next: [LYON_P2, LYON_P2] }), 2),
    { passes: [LYON_P2], credits: 785 },
  );
  assert.deepEqual(previewRun(rotation({ next: [] }), 3), { passes: [], credits: 0 });
  assert.equal(previewRun(rotation({ month_credits_used: null }), 1), null);
});

test("crédits du mois sur le plafond", () => {
  assert.deepEqual(ceilingUsage(rotation()), { used: 1240, ceiling: 7000, pct: (1240 / 7000) * 100 });
  assert.deepEqual(ceilingUsage(rotation({ month_credits_used: 9000 })), { used: 9000, ceiling: 7000, pct: 100 });
  assert.deepEqual(ceilingUsage(rotation({ monthly_ceiling: 0, month_credits_used: 0 })), { used: 0, ceiling: 0, pct: 100 });
  assert.equal(ceilingUsage(rotation({ month_credits_used: null })), null);
});

test("corps de run-due-passes : dry_run exigé et booléen, max_passes de 1 à 5, rien d'autre", () => {
  assert.equal(MAX_PASSES_PER_RUN, 5);
  assert.deepEqual(parseRunDuePassesBody({ max_passes: 5, dry_run: false }), {
    ok: true,
    forward: { max_passes: 5, dry_run: false },
  });
  assert.deepEqual(parseRunDuePassesBody({ dry_run: true }), {
    ok: true,
    forward: { max_passes: 1, dry_run: true },
  });

  const refused: unknown[] = [
    undefined,
    null,
    [],
    "texte",
    {},
    { max_passes: 1 },
    { max_passes: 1, dry_run: "false" },
    { max_passes: 1, dry_run: 1 },
    { max_passes: 1, dryRun: false },
    { max_passes: 0, dry_run: true },
    { max_passes: 6, dry_run: true },
    { max_passes: 2.5, dry_run: true },
    { max_passes: "2", dry_run: true },
  ];
  for (const body of refused) {
    const parsed = parseRunDuePassesBody(body);
    assert.equal(parsed.ok, false, JSON.stringify(body));
  }
  const unknown = parseRunDuePassesBody({ max_passes: 1, dry_run: true, dryRun: false });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.match(unknown.error, /dryRun/);
});

test("rapport d'une simulation : ce qui partirait, sans rien lancer", () => {
  const sim = describeDuePassesReport(
    report({ dry_run: true, status: "success", planned: [LYON_P2, NEOMA_P1], detail: "simulation : …" }),
  );
  assert.equal(sim.tone, "info");
  assert.match(sim.text, /^Simulation : 2 passes partiraient/);
  assert.match(sim.text, /Em Lyon, Phase 2, ~785 crédits ; Neoma, Phase 1, ~30 crédits/);

  const nothing = describeDuePassesReport(
    report({ dry_run: true, status: "success", planned: [], detail: "simulation : aucune passe due" }),
  );
  assert.equal(nothing.tone, "info");
  assert.equal(nothing.text, "Simulation : aucune passe due");

  const broken = describeDuePassesReport(
    report({ dry_run: true, status: "failed", planned: [], detail: "simulation : planification : P1001" }),
  );
  assert.equal(broken.tone, "error");
  assert.match(broken.text, /P1001/);
});

test("rapport d'un lancement : lancé, ou rien de lancé avec la raison", () => {
  const launched = describeDuePassesReport(report());
  assert.equal(launched.tone, "success");
  assert.match(launched.text, /^1 passe lancée : Em Lyon, Phase 2, ~785 crédits/);

  const ceiling = describeDuePassesReport(
    report({ status: "success", planned: [], detail: "plafond mensuel atteint : 6990/7000 crédits" }),
  );
  assert.equal(ceiling.tone, "info");
  assert.equal(ceiling.text, "Aucune passe lancée — plafond mensuel atteint : 6990/7000 crédits");

  const failed = describeDuePassesReport(report({ status: "failed", planned: [], detail: "planification : P1001" }));
  assert.equal(failed.tone, "error");
  assert.equal(failed.text, "Aucune passe lancée — planification : P1001");
});

test("un bloc en erreur est reconnu", () => {
  assert.equal(isRotationError({ error: "P1001" }), true);
  assert.equal(isRotationError(rotation()), false);
});

test("dates de passage", () => {
  assert.equal(formatPassDate(null), "—");
  assert.equal(formatPassDate("pas une date"), "—");
  assert.match(formatPassDate("2026-03-01T03:12:00+00:00"), /2026/);
});
