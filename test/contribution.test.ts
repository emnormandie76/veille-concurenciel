/**
 * La garde qui empêche de clôturer à vide un rapport Research rangé.
 *
 * La Phase 1 range en `Failed` le rapport d'une extraction échouée, pour que sa
 * prochaine passe le reprenne sans repayer Research. Valider ce ticket depuis
 * l'Inbox le clôturerait sans rien écrire, et le rapport ne serait plus repris.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { PARKED_RESEARCH_REPORT, isParkedResearchReport } from "../lib/contribution";

test("reconnaît la charge d'un rapport rangé", () => {
  assert.equal(
    isParkedResearchReport({ parked_reason: PARKED_RESEARCH_REPORT, last_error: "503", extraction_attempts: 2 }),
    true,
  );
});

test("ne confond pas un ticket de découverte ordinaire", () => {
  assert.equal(isParkedResearchReport({ discovered_campuses: [] }), false);
  assert.equal(isParkedResearchReport({ parked_reason: "autre chose" }), false);
});

test("tolère les charges absentes ou d'une autre forme", () => {
  for (const json of [null, undefined, "research_report_parked", 42, [PARKED_RESEARCH_REPORT]]) {
    assert.equal(isParkedResearchReport(json), false, String(json));
  }
});

test("garde la même valeur que le pipeline Python", async () => {
  const { readFile } = await import("node:fs/promises");
  const python = await readFile("backend/pipeline/phase1_research.py", "utf8");
  assert.match(python, new RegExp(`PARKED_REPORT_REASON = "${PARKED_RESEARCH_REPORT}"`));
});
