/**
 * test/api/reports.test.ts — /api/admin/reports : envoyer, lire, traiter un signalement
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 6 :
 * - `POST reports` : toute session signale, USER compris ; l'auteur vient de
 *   la session, jamais du corps ; la cible (campus, programme) doit appartenir
 *   à l'école, active (défaut accepté) ; le nom de la cible est lu en base ;
 *   10 signalements par heure et par compte (D35), comptés après la lecture
 *   du corps et avant toute lecture en base ;
 * - `GET reports` : les gestionnaires, avec le nom affiché de l'auteur
 *   (D39), jamais son adresse ni son identifiant ;
 * - `PATCH reports/[id]` : traiter ou rejeter un signalement en attente ;
 *   celui qui traite vient de la session ; un signalement fermé ne change plus.
 * - Aucune IA : aucun ticket `ContributionInbox` (piège 6).
 *
 * Le plafond (lib/rate-limit.ts) est remplacé par un faux qui retient ses
 * appels ; la vraie implémentation a ses propres tests.
 */

import { afterEach, before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { installFakePrisma, type FakePrismaCall } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";
import { installSession } from "../helpers/session";
import { body, get, params, quietly } from "../helpers/requests";

const db = installFakePrisma();
const session = installSession();

const rate = { allow: true, calls: [] as Array<[string, number, number]> };
mock.module("@/lib/rate-limit", {
  exports: {
    checkRateLimit: async (key: string, limit: number, windowMs: number) => {
      rate.calls.push([key, limit, windowMs]);
      return rate.allow;
    },
  },
});

type Handler = (request: Request, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;
let POST: Handler;
let GET: Handler;
let PATCH: Handler;

before(async () => {
  ({ POST, GET } = (await import("../../app/api/admin/reports/route")) as unknown as { POST: Handler; GET: Handler });
  ({ PATCH } = (await import("../../app/api/admin/reports/[id]/route")) as unknown as { PATCH: Handler });
});

beforeEach(() => {
  session.as("USER");
  rate.allow = true;
  rate.calls.length = 0;
});

afterEach(() => {
  assert.deepEqual(schemaErrors(db.calls), []);
  assert.equal(db.calls.some((c) => c.model === "contributionInbox"), false, "piège 6 : rien dans l'inbox");
});

const SCHOOL = { id: "school-1", name: "Em Normandie", status: "ACTIVE" };
const CAMPUS = { name: "Caen" };
const PROGRAM = { name: "Programme Grande École" };
const MESSAGE = "Les frais de 2026 ont changé : 17 500 € la première année.";

/** La base d'un envoi : l'école, et le campus et le programme s'ils sont à elle. */
function sending({ school = SCHOOL as typeof SCHOOL | null, campus = CAMPUS as typeof CAMPUS | null, program = PROGRAM as typeof PROGRAM | null } = {}) {
  db.use({
    school: { findUnique: () => school },
    campus: { findFirst: ({ where }: { where: { schoolId: string } }) => (where.schoolId === "school-1" ? campus : null) },
    program: { findFirst: ({ where }: { where: { schoolId: string } }) => (where.schoolId === "school-1" ? program : null) },
    contentReport: { create: ({ data }: { data: Record<string, unknown> }) => ({ id: "report-1", ...data }) },
  });
}

const report = (overrides: Record<string, unknown> = {}) =>
  body({ schoolId: "school-1", category: "PRICING", message: MESSAGE, ...overrides });

const created = (): Record<string, unknown> | undefined =>
  (db.calls.find((c) => c.model === "contentReport" && c.method === "create")?.args[0] as { data: Record<string, unknown> } | undefined)?.data;

const writes = (): FakePrismaCall[] => db.writes();

// ─── Envoyer ────────────────────────────────────────────────────────────────

test("POST sans session : 401, rien de lu, le plafond n'est pas consommé", async () => {
  session.as("none");
  sending();
  assert.equal((await POST(report())).status, 401);
  assert.deepEqual(db.calls, []);
  assert.deepEqual(rate.calls, []);
});

test("POST en USER : 201 ; l'auteur est la session, le nom de la cible vient de la base, pas du corps", async () => {
  sending();
  const res = await POST(
    report({
      programId: "program-1",
      message: `  ${MESSAGE}  `,
      source_url: "https://www.em-normandie.com/fr/tarifs",
      author_id: "u-autre",
      target_label: "Un faux nom",
      target_type: "SCHOOL",
      status: "RESOLVED",
      handled_by_id: "u-autre",
    })
  );
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.equal(json.id, "report-1");
  assert.match(json.message, /Mon compte/);
  assert.deepEqual(created(), {
    author_id: "test-user",
    schoolId: "school-1",
    campusId: null,
    programId: "program-1",
    target_type: "PROGRAM",
    target_label: "Programme Grande École",
    category: "PRICING",
    message: MESSAGE,
    source_url: "https://www.em-normandie.com/fr/tarifs",
  });
  const programRead = db.calls.find((c) => c.model === "program")?.args[0] as { where: unknown };
  assert.deepEqual(programRead.where, { id: "program-1", schoolId: "school-1" }, "le programme est cherché dans l'école");
});

test("POST : gestionnaires et admins signalent aussi, chacun en son nom", async () => {
  for (const [profile, id] of [["GESTIONNAIRE", "test-gestionnaire"], ["ADMIN", "test-admin"]] as const) {
    session.as(profile);
    sending();
    assert.equal((await POST(report())).status, 201, profile);
    assert.equal(created()?.author_id, id, profile);
  }
});

test("POST : sans campus ni programme, le signalement vise l'école, sous son nom", async () => {
  sending();
  assert.equal((await POST(report({ campusId: "", programId: null }))).status, 201);
  assert.deepEqual(
    { target_type: created()?.target_type, target_label: created()?.target_label, campusId: created()?.campusId, programId: created()?.programId },
    { target_type: "SCHOOL", target_label: "Em Normandie", campusId: null, programId: null }
  );
  assert.equal(db.calls.some((c) => c.model === "campus" || c.model === "program"), false);
});

test("POST : un campus de l'école, sous son nom", async () => {
  sending();
  assert.equal((await POST(report({ campusId: "campus-1", category: "CAMPUS_PROGRAM" }))).status, 201);
  assert.equal(created()?.target_type, "CAMPUS");
  assert.equal(created()?.target_label, "Caen");
  assert.equal(created()?.campusId, "campus-1");
});

test("POST : un campus ou un programme d'une autre école est refusé (400), rien n'est écrit", async () => {
  for (const target of [{ campusId: "campus-x" }, { programId: "program-x" }]) {
    sending({ campus: null, program: null });
    const res = await POST(report(target));
    assert.equal(res.status, 400, JSON.stringify(target));
    assert.match((await res.json()).error, /n'appartient pas à cette école/);
    assert.deepEqual(writes(), []);
  }
});

test("POST : une école inconnue ou inactive n'a pas de formulaire (404), rien n'est écrit", async () => {
  for (const school of [null, { ...SCHOOL, status: "INACTIVE" }]) {
    sending({ school });
    assert.equal((await POST(report())).status, 404);
    assert.deepEqual(writes(), []);
  }
});

test("POST : un corps illisible ou incomplet est refusé (400) avant le plafond et la base", async () => {
  const bad = [
    body("{pas du json"),
    body([1, 2]),
    report({ message: "x".repeat(9) }),
    report({ category: "Pending_AI" }),
    report({ source_url: "javascript:alert(1)" }),
    report({ campusId: "campus-1", programId: "program-1" }),
    report({ schoolId: "" }),
  ];
  for (const request of bad) {
    sending();
    assert.equal((await POST(request)).status, 400);
    assert.deepEqual(db.calls, []);
  }
  assert.deepEqual(rate.calls, [], "un envoi refusé ne compte pas");
});

test("D35 : 10 par heure et par compte ; au-delà, 429 avec Retry-After, rien de lu ni d'écrit", async () => {
  sending();
  assert.equal((await POST(report())).status, 201);
  assert.deepEqual(rate.calls, [["report:test-user", 10, 3_600_000]]);

  rate.allow = false;
  sending();
  const res = await POST(report());
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "3600");
  assert.match((await res.json()).error, /heure/);
  assert.deepEqual(db.calls, []);
});

test("POST : une panne de la base rend 500", async () => {
  db.use({
    school: { findUnique: () => SCHOOL },
    contentReport: {
      create: () => {
        throw new Error("base injoignable");
      },
    },
  });
  assert.equal((await quietly(() => POST(report()))).status, 500);
});

// ─── Lire ───────────────────────────────────────────────────────────────────

const AT = new Date("2026-10-20T09:15:00Z");
const ROW = {
  id: "report-1",
  schoolId: "school-1",
  campusId: null,
  programId: "program-1",
  target_type: "PROGRAM",
  target_label: "Programme Grande École",
  category: "PRICING",
  message: MESSAGE,
  source_url: "https://www.em-normandie.com/fr/tarifs",
  status: "OPEN",
  response: null,
  created_at: AT,
  handled_at: null,
  school: { name: "Em Normandie" },
  author: { display_name: "Camille Martin" },
  handledBy: null,
};
const CLOSED = { ...ROW, id: "report-0", status: "REJECTED", response: "Déjà à jour.", handled_at: AT, handledBy: { display_name: "Goat" } };

test("GET : 401 sans session, 403 pour un USER, rien de lu", async () => {
  for (const [profile, status] of [["none", 401], ["USER", 403]] as const) {
    session.as(profile);
    db.use({});
    assert.equal((await GET(get())).status, status, profile);
    assert.deepEqual(db.calls, []);
  }
});

test("GET en gestionnaire : les signalements en attente (les plus anciens d'abord), puis les 100 derniers fermés", async () => {
  session.as("GESTIONNAIRE");
  db.use({ contentReport: { findMany: ({ where }: { where: { status: unknown } }) => (where.status === "OPEN" ? [ROW] : [CLOSED]) } });
  const res = await GET(get());
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json.open.map((r: { id: string }) => r.id), ["report-1"]);
  assert.deepEqual(json.closed.map((r: { id: string }) => r.id), ["report-0"]);
  assert.equal(json.open[0].author, "Camille Martin");
  assert.equal(json.open[0].manage_href, "/admin/schools/school-1/manage?tab=pricing");
  assert.equal(json.closed[0].handled_by, "Goat");

  const [open, closed] = db.calls.filter((c) => c.model === "contentReport").map((c) => c.args[0] as Record<string, unknown>);
  assert.deepEqual(open.where, { status: "OPEN" });
  assert.deepEqual(open.orderBy, { created_at: "asc" });
  assert.deepEqual(closed.where, { status: { not: "OPEN" } });
  assert.deepEqual(closed.orderBy, { handled_at: "desc" });
  assert.equal(closed.take, 100);
  for (const call of [open, closed]) {
    const select = call.select as Record<string, unknown>;
    assert.deepEqual(select.author, { select: { display_name: true } }, "D39 : le nom affiché seul");
    assert.deepEqual(select.handledBy, { select: { display_name: true } });
    assert.equal("author_id" in select || "handled_by_id" in select, false);
  }
  const text = JSON.stringify(json);
  assert.equal(/author_id|handled_by_id|@em-normandie\.fr/.test(text), false, "ni identifiant ni adresse");
});

test("GET : une panne de la base rend 500", async () => {
  session.as("ADMIN");
  db.use({
    contentReport: {
      findMany: () => {
        throw new Error("base injoignable");
      },
    },
  });
  assert.equal((await quietly(() => GET(get()))).status, 500);
});

// ─── Traiter, rejeter ───────────────────────────────────────────────────────

const decide = (payload: unknown) => body(payload, "PATCH");

function deciding({ open = true, exists = true } = {}) {
  db.use({
    contentReport: {
      updateMany: () => ({ count: open && exists ? 1 : 0 }),
      findUnique: () => (exists ? { status: open ? "OPEN" : "RESOLVED" } : null),
    },
  });
}

test("PATCH : 401 sans session, 403 pour un USER, rien de lu ni d'écrit", async () => {
  for (const [profile, status] of [["none", 401], ["USER", 403]] as const) {
    session.as(profile);
    deciding();
    assert.equal((await PATCH(decide({ status: "RESOLVED" }), params({ id: "report-1" }))).status, status, profile);
    assert.deepEqual(db.calls, []);
  }
});

test("PATCH en gestionnaire : traité, avec la réponse ; celui qui traite vient de la session", async () => {
  session.as("GESTIONNAIRE");
  deciding();
  const before = Date.now();
  const res = await PATCH(
    decide({ status: "RESOLVED", response: "  Tarif corrigé, merci.  ", handled_by_id: "u-autre", author_id: "u-autre" }),
    params({ id: "report-1" })
  );
  assert.equal(res.status, 200);
  const [update] = db.calls.filter((c) => c.method === "updateMany").map((c) => c.args[0] as { where: unknown; data: Record<string, unknown> });
  assert.deepEqual(update.where, { id: "report-1", status: "OPEN" }, "seul un signalement en attente se ferme");
  const { handled_at, ...data } = update.data;
  assert.deepEqual(data, { status: "RESOLVED", response: "Tarif corrigé, merci.", handled_by_id: "test-gestionnaire" });
  assert.ok(handled_at instanceof Date && handled_at.getTime() >= before);
});

test("PATCH : rejeté sans réponse ; un admin le peut aussi", async () => {
  session.as("ADMIN");
  deciding();
  assert.equal((await PATCH(decide({ status: "REJECTED" }), params({ id: "report-1" }))).status, 200);
  const update = db.calls.find((c) => c.method === "updateMany")?.args[0] as { data: Record<string, unknown> };
  assert.equal(update.data.status, "REJECTED");
  assert.equal(update.data.response, null);
  assert.equal(update.data.handled_by_id, "test-admin");
});

test("PATCH : un signalement déjà fermé ne change plus (409) ; un inconnu rend 404", async () => {
  session.as("GESTIONNAIRE");
  deciding({ open: false });
  assert.equal((await PATCH(decide({ status: "REJECTED" }), params({ id: "report-1" }))).status, 409);
  deciding({ exists: false });
  assert.equal((await PATCH(decide({ status: "REJECTED" }), params({ id: "absent" }))).status, 404);
});

test("PATCH : une décision illisible est refusée (400), rien n'est écrit", async () => {
  session.as("GESTIONNAIRE");
  for (const request of [decide({ status: "OPEN" }), decide({ status: "Validated" }), decide({ status: "RESOLVED", response: "x".repeat(1001) }), decide("{pas du json")]) {
    deciding();
    assert.equal((await PATCH(request, params({ id: "report-1" }))).status, 400);
    assert.deepEqual(db.calls, []);
  }
});

test("PATCH : une panne de la base rend 500", async () => {
  session.as("GESTIONNAIRE");
  db.use({
    contentReport: {
      updateMany: () => {
        throw new Error("base injoignable");
      },
    },
  });
  assert.equal((await quietly(() => PATCH(decide({ status: "RESOLVED" }), params({ id: "report-1" })))).status, 500);
});
