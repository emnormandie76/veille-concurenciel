/**
 * test/crowdsourcing-status.test.ts — Le traitement des contributions et les
 * modèles d'IA, tels que /admin/cron les affiche
 *
 *     npm run test:ts
 *
 * Tâche hors plan C1 à C4 (journal du 15 octobre 2026). Le bloc
 * `scheduler.crowdsourcing` de `GET /internal/pipeline-status` porte le dernier
 * passage et le dernier passage qui a traité au moins un ticket ; la suite
 * Python tient sa forme (test_crowdsourcing_report.py). `ai_models` remplace
 * les trois `ai_model_*` écrits en dur. Sans React ni serveur : les décisions
 * d'affichage vivent dans lib/, comme lib/rotation-status.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  describeCrowdsourcing,
  describeCrowdsourcingCounts,
  type CrowdsourcingBlock,
  type CrowdsourcingCounts,
} from "../lib/crowdsourcing-status";
import { describeAiModels, type AiModelsBlock } from "../lib/ai-models";

function counts(overrides: Partial<CrowdsourcingCounts> = {}): CrowdsourcingCounts {
  return {
    tickets: 0,
    validated: 0,
    rejected: 0,
    deleted: 0,
    failed: 0,
    deferred: 0,
    quota_exhausted: false,
    ...overrides,
  };
}

const FINISHED_AT = "2026-10-15T09:30:00+00:00";

function block(processed: Partial<CrowdsourcingCounts> | null, status: "success" | "failed" = "success"): CrowdsourcingBlock {
  return {
    last_run: { status: "success", detail: "aucune contribution en attente", finished_at: "2026-10-15T09:31:00+00:00" },
    last_processed:
      processed === null
        ? null
        : { status, detail: "…", finished_at: FINISHED_AT, counts: counts(processed) },
  };
}

// ── Les comptes ──────────────────────────────────────────────────────

test("chaque issue a son mot ; une page incompatible n'est pas « validée »", () => {
  const parts = describeCrowdsourcingCounts(
    counts({ tickets: 7, validated: 1, rejected: 1, deleted: 2, failed: 2, deferred: 1 }),
  );

  assert.deepEqual(parts, [
    "1 en attente de l'admin",
    "1 rejetée (page incompatible)",
    "2 supprimées (erreur permanente)",
    "2 en échec (tentative comptée)",
    "1 différée (aucun modèle disponible)",
  ]);
});

test("les issues à zéro ne sont pas dites", () => {
  assert.deepEqual(describeCrowdsourcingCounts(counts({ tickets: 3, validated: 3 })), ["3 en attente de l'admin"]);
  assert.deepEqual(describeCrowdsourcingCounts(counts({ tickets: 1, rejected: 1 })), [
    "1 rejetée (page incompatible)",
  ]);
});

test("l'arrêt sur quota Tavily est dit", () => {
  assert.deepEqual(describeCrowdsourcingCounts(counts({ tickets: 2, validated: 1, quota_exhausted: true })), [
    "1 en attente de l'admin",
    "traitement interrompu : quota Tavily épuisé",
  ]);
});

// ── Le bloc ──────────────────────────────────────────────────────────

test("un backend qui ne remonte pas le bloc : une phrase, ton neutre", () => {
  const view = describeCrowdsourcing(undefined);

  assert.equal(view.tone, "muted");
  assert.match(view.headline, /ne remonte pas/);
  assert.deepEqual(view.lines, []);
});

test("aucun ticket traité depuis le démarrage : ton neutre, et le dernier passage vide reste dit", () => {
  const view = describeCrowdsourcing(block(null));

  assert.equal(view.tone, "muted");
  assert.match(view.headline, /Aucune contribution traitée depuis le démarrage du backend/);
  assert.ok(view.lines.some((line) => /Dernier passage .*aucune contribution en attente/.test(line)));
});

test("le dernier passage utile reste affiché malgré un dernier passage vide", () => {
  const view = describeCrowdsourcing(block({ tickets: 2, validated: 1, deleted: 1 }));

  assert.match(view.headline, /^Dernier passage utile : .+ — 2 contributions traitées$/);
  assert.deepEqual(view.lines.slice(0, 2), ["1 en attente de l'admin", "1 supprimée (erreur permanente)"]);
  // Et le passage vide, plus récent, est dit à part.
  assert.ok(view.lines.some((line) => /aucune contribution en attente/.test(line)));
});

test("un ticket traité sans histoire : ton « ok »", () => {
  assert.equal(describeCrowdsourcing(block({ tickets: 1, validated: 1 })).tone, "ok");
});

test("un rejet seul n'inquiète pas : la page était incompatible", () => {
  assert.equal(describeCrowdsourcing(block({ tickets: 1, rejected: 1 })).tone, "ok");
});

test("une suppression, un échec ou une attente sont un avertissement", () => {
  for (const issue of [{ deleted: 1 }, { failed: 1 }, { deferred: 1 }]) {
    assert.equal(describeCrowdsourcing(block({ tickets: 1, ...issue })).tone, "warning", JSON.stringify(issue));
  }
});

test("un arrêt sur quota est une erreur", () => {
  const view = describeCrowdsourcing(block({ tickets: 1, quota_exhausted: true }, "failed"));

  assert.equal(view.tone, "error");
});

test("un dernier passage en échec (base injoignable) est dit, même sans passage utile", () => {
  const view = describeCrowdsourcing({
    last_run: { status: "failed", detail: "lecture de la file impossible", finished_at: FINISHED_AT },
    last_processed: null,
  });

  assert.equal(view.tone, "error");
  assert.ok(view.lines.some((line) => /en échec : lecture de la file impossible/.test(line)));
});

test("un seul ticket : le singulier", () => {
  assert.match(describeCrowdsourcing(block({ tickets: 1, validated: 1 })).headline, /1 contribution traitée$/);
});

// ── Les modèles d'IA ─────────────────────────────────────────────────

const MODELS: AiModelsBlock = {
  cascade: [
    { model: "models/gemini-3.8-flash", tier: "high" },
    { model: "models/gemini-3.5-flash", tier: "mid" },
    { model: "models/gemini-2.5-flash", tier: "low" },
  ],
  last_resort: {
    compatibility: "models/gemma-4-26b-a4b-it",
    extraction: "models/gemma-4-31b-it",
  },
};

test("les modèles : la cascade Gemini d'abord, Gemma en dernier recours", () => {
  const view = describeAiModels(MODELS);

  assert.ok(view);
  assert.equal(view.headline, "Cascade Gemini, Gemma en dernier recours");
  assert.equal(view.cascade, "gemini-3.8-flash → gemini-3.5-flash → gemini-2.5-flash");
  assert.equal(view.lastResort, "gemma-4-31b-it (extraction), gemma-4-26b-a4b-it (compatibilité)");
});

test("sans le bloc (ancien backend), rien n'est affiché à la place d'un modèle faux", () => {
  assert.equal(describeAiModels(undefined), null);
});
