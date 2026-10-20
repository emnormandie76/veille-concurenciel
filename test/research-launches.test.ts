/**
 * test/research-launches.test.ts — Les règles du journal des lancements (lib/research-launches.ts)
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 7 : Next.js note chaque lancement d'une
 * recherche IA dans `ResearchLaunch` (D14), avant l'appel au backend (D41),
 * puis l'issue que le backend a donnée. Deux règles vivent ici, sans base ni
 * réseau :
 *
 * - **l'issue** d'un lancement : parti (`STARTED`), pas parti
 *   (`NOT_STARTED`), ou inconnu (`UNKNOWN` : délai dépassé, réponse
 *   illisible ; la demande a pu partir) ;
 * - **la fenêtre des passes dues** (D40) : la réponse 202 ne porte aucun id
 *   de job ; les jobs `rotation` créés après un lancement qui a pu partir,
 *   jusqu'au suivant et au plus N, lui reviennent.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LAUNCH_DETAIL_MAX_LENGTH,
  LAUNCH_KINDS,
  LAUNCH_STATUSES,
  attributeDuePasses,
  launchOutcome,
  mayHaveStarted,
} from "../lib/research-launches";
import type { BackendResult } from "../lib/internal-api";

const answered = (status: number, data: unknown): BackendResult => ({ kind: "answered", status, data });

const TIMEOUT: BackendResult = {
  kind: "failed",
  status: 504,
  code: "BACKEND_TIMEOUT",
  error: "Le backend n'a pas répondu en 30 s. La demande a pu partir : consultez l'historique avant de relancer.",
};
const NOT_RUNNING: BackendResult = {
  kind: "failed",
  status: 503,
  code: "BACKEND_NOT_RUNNING",
  error: "Backend local injoignable (ECONNREFUSED) : est-il lancé ?",
};
const BAD_RESPONSE: BackendResult = {
  kind: "failed",
  status: 502,
  code: "BACKEND_BAD_RESPONSE",
  error: "Réponse illisible du backend (HTTP 500).",
};

test("les listes de référence", () => {
  assert.deepEqual([...LAUNCH_KINDS], ["TARGETED", "DUE_PASSES"]);
  assert.deepEqual([...LAUNCH_STATUSES], ["PENDING", "STARTED", "NOT_STARTED", "UNKNOWN"]);
  assert.equal(LAUNCH_DETAIL_MAX_LENGTH, 1000);
});

test("recherche ciblée : un 200 qui rend l'id du job est parti, avec son id", () => {
  const outcome = launchOutcome(
    "TARGETED",
    answered(200, { message: "Recherche ciblée déclenchée", job_id: "job-1", status: "queued" })
  );
  assert.deepEqual(outcome, {
    status: "STARTED",
    http_status: 200,
    job_id: "job-1",
    detail: "Recherche ciblée déclenchée",
  });
});

test("recherche ciblée : un 200 sans id de job ne se relie pas, et ne se dit pas parti à coup sûr", () => {
  for (const data of [{ message: "ok" }, { job_id: "" }, { job_id: 42 }, null, "texte"]) {
    const outcome = launchOutcome("TARGETED", answered(200, data));
    assert.equal(outcome.status, "UNKNOWN", JSON.stringify(data));
    assert.equal(outcome.job_id, null);
    assert.equal(outcome.http_status, 200);
  }
});

test("recherche ciblée : un refus du backend n'a rien lancé, et son message est gardé", () => {
  const busy = answered(409, {
    detail: { code: "ALREADY_RUNNING", message: "Une tâche est déjà en cours pour cette école (job j-0, Phase 1 — Cartographie)" },
  });
  assert.deepEqual(launchOutcome("TARGETED", busy), {
    status: "NOT_STARTED",
    http_status: 409,
    job_id: null,
    detail: "Une tâche est déjà en cours pour cette école (job j-0, Phase 1 — Cartographie)",
  });

  const unknown = launchOutcome("TARGETED", answered(404, { detail: { code: "SCHOOL_NOT_FOUND", message: "École inconnue" } }));
  assert.equal(unknown.status, "NOT_STARTED");
  assert.equal(unknown.detail, "École inconnue");
});

test("passes dues : un 202 « planned » est parti, avec le plan pour détail", () => {
  const outcome = launchOutcome(
    "DUE_PASSES",
    answered(202, { status: "planned", detail: "1 passe(s) au départ : Em Lyon, Phase 2, ~785 crédits", planned: [] })
  );
  assert.deepEqual(outcome, {
    status: "STARTED",
    http_status: 202,
    job_id: null,
    detail: "1 passe(s) au départ : Em Lyon, Phase 2, ~785 crédits",
  });
});

test("passes dues : un 202 final (rien de dû, plafond, planification impossible) n'a rien lancé", () => {
  for (const [status, detail] of [
    ["success", "aucune passe due"],
    ["success", "plafond mensuel atteint : 7000/7000 crédits"],
    ["failed", "planification : connexion perdue"],
  ]) {
    const outcome = launchOutcome("DUE_PASSES", answered(202, { status, detail }));
    assert.equal(outcome.status, "NOT_STARTED", detail);
    assert.equal(outcome.detail, detail);
    assert.equal(outcome.job_id, null);
  }
});

test("passes dues : 409 et 503 du backend n'ont rien lancé", () => {
  const busy = launchOutcome("DUE_PASSES", answered(409, { detail: { code: "ALREADY_RUNNING", message: "Une exécution tourne déjà" } }));
  assert.equal(busy.status, "NOT_STARTED");
  assert.equal(busy.detail, "Une exécution tourne déjà");

  const sync = launchOutcome("DUE_PASSES", answered(503, { detail: { code: "USAGE_SYNC_FAILED", message: "synchro /usage en échec" } }));
  assert.equal(sync.status, "NOT_STARTED");
});

test("un backend injoignable n'a rien reçu ; un délai dépassé ou une réponse illisible laissent l'issue inconnue", () => {
  for (const kind of LAUNCH_KINDS) {
    assert.deepEqual(launchOutcome(kind, NOT_RUNNING), {
      status: "NOT_STARTED",
      http_status: 503,
      job_id: null,
      detail: `BACKEND_NOT_RUNNING : ${(NOT_RUNNING as { error: string }).error}`,
    });
    const late = launchOutcome(kind, TIMEOUT);
    assert.equal(late.status, "UNKNOWN", kind);
    assert.equal(late.http_status, 504);
    assert.match(late.detail ?? "", /^BACKEND_TIMEOUT : .*a pu partir/);
    assert.equal(launchOutcome(kind, BAD_RESPONSE).status, "UNKNOWN", kind);
  }
});

test("le détail est borné à 1 000 caractères, comptés comme char_length de Postgres", () => {
  const long = "é".repeat(600) + "😀".repeat(600);
  const outcome = launchOutcome("DUE_PASSES", answered(202, { status: "planned", detail: long }));
  assert.equal(Array.from(outcome.detail ?? "").length, LAUNCH_DETAIL_MAX_LENGTH);
  assert.equal(launchOutcome("DUE_PASSES", answered(202, { status: "planned" })).detail, null);
});

test("seul un lancement qui n'est pas parti ferme une fenêtre : en attente, parti ou inconnu ont pu lancer", () => {
  assert.equal(mayHaveStarted("PENDING"), true);
  assert.equal(mayHaveStarted("STARTED"), true);
  assert.equal(mayHaveStarted("UNKNOWN"), true);
  assert.equal(mayHaveStarted("NOT_STARTED"), false);
});

const at = (iso: string) => new Date(`2026-10-20T${iso}Z`);
const job = (id: string, time: string) => ({ id, started_at: at(time) });

test("D40 : les jobs créés après un lancement lui reviennent, au plus N", () => {
  const owners = attributeDuePasses(
    [job("r1", "10:00:05"), job("r2", "10:40:00"), job("r3", "11:20:00")],
    [{ launched_at: at("10:00:00"), max_passes: 2, launcher: "Goat" }]
  );
  // Le troisième dépasse les deux passes demandées : il ne vient pas de ce lancement.
  assert.deepEqual([...owners], [
    ["r1", "Goat"],
    ["r2", "Goat"],
  ]);
});

test("D40 : la fenêtre s'arrête au lancement suivant, et un job d'avant tout lancement reste sans lanceur", () => {
  const owners = attributeDuePasses(
    [job("old", "08:00:00"), job("a1", "10:00:01"), job("b1", "12:00:00"), job("b2", "12:30:00")],
    [
      { launched_at: at("10:00:00"), max_passes: 5, launcher: "Goat" },
      { launched_at: at("11:59:59"), max_passes: 5, launcher: "Alice Martin" },
    ]
  );
  assert.equal(owners.get("old"), undefined);
  assert.equal(owners.get("a1"), "Goat");
  assert.equal(owners.get("b1"), "Alice Martin");
  assert.equal(owners.get("b2"), "Alice Martin");
});

test("D40 : un job né à l'instant du lancement lui revient ; l'ordre des listes reçues n'importe pas", () => {
  const owners = attributeDuePasses(
    [job("r2", "10:00:09"), job("r1", "10:00:00")],
    [
      { launched_at: at("10:00:05"), max_passes: 1, launcher: "Second" },
      { launched_at: at("10:00:00"), max_passes: 1, launcher: "Premier" },
    ]
  );
  assert.equal(owners.get("r1"), "Premier");
  assert.equal(owners.get("r2"), "Second");
});

test("D40 : sans lancement, aucun job n'a de lanceur", () => {
  assert.equal(attributeDuePasses([job("r1", "10:00:00")], []).size, 0);
});
