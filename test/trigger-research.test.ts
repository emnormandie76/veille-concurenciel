/**
 * test/trigger-research.test.ts — L'interrupteur de la collecte du rattachement campus
 *
 *     npm run test:ts
 *
 * Le corps part de l'écran admin (`buildLaunchBody`), la route le relit
 * (`parseTriggerResearchBody`) et transmet `forward` tel quel à FastAPI. Ces
 * tests enchaînent les deux, dans les deux états de la case : décochée, rien
 * ne doit activer la collecte ; cochée, la valeur doit arriver jusqu'au
 * backend. La suite Python prend le relais au-delà de FastAPI.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildLaunchBody,
  describeCampusCollection,
  parseTriggerResearchBody,
  type LaunchSelection,
} from "../lib/trigger-research";

const EM_NORMANDIE = "fe46bddf-0d27-49d2-a9f8-df90a5c3b033";

function selection(overrides: Partial<LaunchSelection> = {}): LaunchSelection {
  return {
    schoolId: EM_NORMANDIE,
    phase: "1",
    programId: "",
    categories: [],
    collectCampusAttachments: false,
    ...overrides,
  };
}

/** Le trajet complet côté Next : l'écran, puis la route. */
function forwarded(sel: LaunchSelection) {
  const parsed = parseTriggerResearchBody(buildLaunchBody(sel));
  assert.ok(parsed.ok, "le corps de l'écran doit passer la route");
  return parsed;
}

test("case décochée : la Phase 1 part sans collecte, et le dit", () => {
  const body = buildLaunchBody(selection());
  assert.deepEqual(body, {
    school_id: EM_NORMANDIE,
    phase: "1",
    collect_campus_attachments: false,
  });

  const parsed = forwarded(selection());
  assert.equal(parsed.schoolId, EM_NORMANDIE);
  assert.deepEqual(parsed.forward, {
    phase: "1",
    program_id: null,
    categories: null,
    collect_campus_attachments: false,
  });
});

test("case cochée : la collecte est transmise à FastAPI", () => {
  const parsed = forwarded(selection({ collectCampusAttachments: true }));
  assert.equal(parsed.forward.collect_campus_attachments, true);
  assert.equal(parsed.forward.phase, "1");
});

test("un appel sans le champ vaut désactivé, pas activé", () => {
  const parsed = parseTriggerResearchBody({ school_id: EM_NORMANDIE, phase: "1" });
  assert.ok(parsed.ok);
  assert.equal(parsed.forward.collect_campus_attachments, false);
});

test("une valeur qui n'est pas un booléen est refusée, pas lue comme un non", () => {
  for (const value of ["true", 1, null, "false"]) {
    const parsed = parseTriggerResearchBody({
      school_id: EM_NORMANDIE,
      phase: "1",
      collect_campus_attachments: value,
    });
    assert.deepEqual(parsed, {
      ok: false,
      error: "collect_campus_attachments doit être un booléen",
    });
  }
});

test("la Phase 2 n'emporte jamais la collecte", () => {
  // L'écran : même si la case était restée cochée, le corps de Phase 2 ne la porte pas.
  const body = buildLaunchBody(
    selection({ phase: "2", collectCampusAttachments: true, programId: "p1", categories: ["Pricing"] })
  );
  assert.equal("collect_campus_attachments" in body, false);
  assert.deepEqual(forwarded(selection({ phase: "2" })).forward, {
    phase: "2",
    program_id: null,
    categories: null,
    collect_campus_attachments: false,
  });

  // La route : un appel direct qui la demande en Phase 2 est refusé.
  const parsed = parseTriggerResearchBody({
    school_id: EM_NORMANDIE,
    phase: "2",
    collect_campus_attachments: true,
  });
  assert.deepEqual(parsed, {
    ok: false,
    error: "La collecte du rattachement campus ne concerne que la Phase 1",
  });
});

test("les refus d'avant l'interrupteur sont inchangés", () => {
  assert.deepEqual(parseTriggerResearchBody({ phase: "1" }), { ok: false, error: "school_id est requis" });
  assert.deepEqual(parseTriggerResearchBody(null), { ok: false, error: "school_id est requis" });
  assert.deepEqual(parseTriggerResearchBody({ school_id: EM_NORMANDIE, phase: "3" }), {
    ok: false,
    error: "phase doit être '1' ou '2'",
  });
  const phase2 = parseTriggerResearchBody({
    school_id: EM_NORMANDIE,
    phase: "2",
    program_id: "p1",
    categories: ["Pricing", "Capacity"],
  });
  assert.ok(phase2.ok);
  assert.deepEqual(phase2.forward, {
    phase: "2",
    program_id: "p1",
    categories: ["Pricing", "Capacity"],
    collect_campus_attachments: false,
  });
});

test("l'écran affiche ce que le backend a compris, et signale un backend muet", () => {
  assert.equal(describeCampusCollection(true), "rattachement campus : collecte activée");
  assert.equal(describeCampusCollection(false), "rattachement campus : collecte désactivée");
  assert.match(describeCampusCollection(undefined), /^⚠️ .*n'a pas confirmé l'interrupteur/);
});
