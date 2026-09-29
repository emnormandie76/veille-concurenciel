/**
 * test/rotation-status.test.ts — Le panneau « Rotation automatique » de /admin/cron
 *
 *     npm run test:ts
 *
 * Le bloc vient de `GET /internal/pipeline-status` (`scheduler.rotation`) ; la
 * suite Python tient sa forme (test_rotation_status.py). Ces tests tiennent ce
 * que le panneau en dit : active, à blanc ou inactive, et si une passe tient
 * sous le plafond — la même règle que le job nocturne.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ceilingUsage,
  describeRotation,
  fitsUnderCeiling,
  formatPassDate,
  isRotationError,
  rotationMode,
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

function rotation(overrides: Partial<RotationStatus> = {}): RotationStatus {
  return {
    enabled: true,
    hour: 3,
    timezone: "Europe/Paris",
    interval_days: 182,
    passes_per_night: 1,
    monthly_ceiling: 7000,
    month_credits_used: 1240,
    due_count: 1,
    next: [LYON_P2],
    last_night: null,
    ...overrides,
  };
}

test("active : l'horaire et le rythme se lisent", () => {
  assert.equal(rotationMode(rotation()), "active");
  assert.equal(
    describeRotation(rotation()),
    "Active — chaque nuit à 3 h (Europe/Paris), une passe au plus, retour tous les 182 jours",
  );
});

test("plafond à 0 : la vérification à blanc se dit comme telle", () => {
  const dry = rotation({ monthly_ceiling: 0 });
  assert.equal(rotationMode(dry), "dry_run");
  assert.match(describeRotation(dry), /^À blanc — plafond à 0/);
});

test("inactive : la raison du backend est donnée", () => {
  const off = rotation({ enabled: false });
  const reason = "ENVIRONMENT=development : hors production, les jobs Research ne sont pas inscrits";
  assert.equal(rotationMode(off), "inactive");
  assert.equal(describeRotation(off, { enabled: false, reason }), `Inactive — ${reason}`);
  // Un plafond à 0 ne rend pas « à blanc » une rotation qui ne tourne pas.
  assert.equal(rotationMode(rotation({ enabled: false, monthly_ceiling: 0 })), "inactive");
});

test("une passe tient sous le plafond selon la règle du job", () => {
  assert.equal(fitsUnderCeiling(LYON_P2, rotation({ month_credits_used: 6215 })), true);
  assert.equal(fitsUnderCeiling(LYON_P2, rotation({ month_credits_used: 6216 })), false);
  assert.equal(fitsUnderCeiling(LYON_P2, rotation({ monthly_ceiling: 0, month_credits_used: 0 })), false);
  assert.equal(fitsUnderCeiling(LYON_P2, rotation({ month_credits_used: null })), null);
});

test("crédits du mois sur le plafond", () => {
  assert.deepEqual(ceilingUsage(rotation()), { used: 1240, ceiling: 7000, pct: (1240 / 7000) * 100 });
  assert.deepEqual(ceilingUsage(rotation({ month_credits_used: 9000 })), { used: 9000, ceiling: 7000, pct: 100 });
  assert.deepEqual(ceilingUsage(rotation({ monthly_ceiling: 0, month_credits_used: 0 })), { used: 0, ceiling: 0, pct: 100 });
  assert.equal(ceilingUsage(rotation({ month_credits_used: null })), null);
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
