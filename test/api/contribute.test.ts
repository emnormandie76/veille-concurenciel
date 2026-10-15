/**
 * test/api/contribute.test.ts — POST /api/contribute
 *
 *     npm run test:ts
 *
 * La seule écriture publique, non authentifiée et à coût réel : chaque ticket
 * déclenche une extraction Tavily facturée (architecture.md §10.2). Plan
 * backend-local, étape 7 (P0) : plafonds, `https` seulement, hôte interne
 * refusé, domaine de l'école ou liste blanche, appartenance des identifiants à
 * l'école, un ticket par catégorie dans une transaction, `user_text` stocké.
 *
 * La limitation de débit vit dans `proxy.ts` (test/proxy.test.ts), pas ici.
 */

import { afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { installFakePrisma, type FakeModels } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";

const db = installFakePrisma();

// Chaque requête reçue par le faux doit exister dans le vrai schéma Prisma
// (test/helpers/prisma-schema.ts).
afterEach(() => {
  assert.deepEqual(schemaErrors(db.calls), []);
});

type Handler = (request: Request) => Promise<Response>;
let POST: Handler;

before(async () => {
  ({ POST } = await import("../../app/api/contribute/route"));
});

const SCHOOL = { id: "school-normandie", status: "ACTIVE", official_domain: "www.em-normandie.com" };
const OTHER_SCHOOL = "school-lyon";

/** La base : une école, ses campus, programmes et arêtes, et l'écriture. */
function withDatabase(overrides: FakeModels = {}): void {
  db.use({
    school: { findUnique: () => SCHOOL },
    campus: {
      findUnique: ({ where }: { where: { id: string } }) =>
        ({
          "campus-caen": { schoolId: SCHOOL.id },
          "campus-lyon": { schoolId: OTHER_SCHOOL },
        })[where.id] ?? null,
    },
    program: {
      findUnique: ({ where }: { where: { id: string } }) =>
        ({
          "program-pge": { schoolId: SCHOOL.id },
          "program-msc": { schoolId: SCHOOL.id },
          "program-lyon": { schoolId: OTHER_SCHOOL },
        })[where.id] ?? null,
    },
    programCampus: {
      findUnique: ({ where }: { where: { id: string } }) =>
        ({
          "pc-pge-caen": { programId: "program-pge", campusId: "campus-caen", program: { schoolId: SCHOOL.id } },
          "pc-lyon": { programId: "program-lyon", campusId: "campus-lyon", program: { schoolId: OTHER_SCHOOL } },
        })[where.id] ?? null,
    },
    contributionInbox: {
      create: ({ data }: { data: Record<string, unknown> }) => ({ id: `ticket-${data.ai_category}`, ...data }),
    },
    ...overrides,
  });
}

beforeEach(() => {
  withDatabase();
  delete process.env.CONTRIBUTION_ALLOWED_DOMAINS;
});

afterEach(() => {
  delete process.env.CONTRIBUTION_ALLOWED_DOMAINS;
});

const VALID = {
  schoolId: SCHOOL.id,
  categories: ["Pricing"],
  urls: ["https://www.em-normandie.com/fr/programme-grande-ecole/frais"],
  userText: "Les frais ont augmenté cette année.",
};

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/contribute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

function created(): Array<Record<string, unknown>> {
  return db
    .writes()
    .filter((c) => c.model === "contributionInbox" && c.method === "create")
    .map((c) => (c.args[0] as { data: Record<string, unknown> }).data);
}

/** Un refus : 400, et aucun ticket de plus que ceux des requêtes précédentes du test. */
async function refused(body: unknown, pattern?: RegExp): Promise<void> {
  const before = created().length;
  const res = await post(body);
  assert.equal(res.status, 400, JSON.stringify(body).slice(0, 200));
  if (pattern) assert.match((await res.json()).error, pattern);
  assert.equal(created().length, before, "aucun ticket ne doit être écrit");
}

// ── Cas nominal ──────────────────────────────────────────────────────

test("cas nominal : un ticket Pending_AI, user_text et urls stockés, source User_Submission", async () => {
  const res = await post({ ...VALID, userText: "  Les frais ont augmenté.  " });

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, ticketsCreated: 1 });
  const [{ submission_group_id, ...ticket }] = created();
  assert.equal(typeof submission_group_id, "string");
  assert.deepEqual([ticket], [
    {
      source_type: "User_Submission",
      schoolId: SCHOOL.id,
      campusId: null,
      programId: null,
      programCampusId: null,
      user_text: "Les frais ont augmenté.",
      urls: VALID.urls,
      ai_category: "Pricing",
      status: "Pending_AI",
    },
  ]);
});

test("un ticket par catégorie, dans une seule transaction, avec le même texte et les mêmes URL", async () => {
  const res = await post({ ...VALID, categories: ["Pricing", "Ranking", "Capacity"] });

  assert.equal(res.status, 200);
  assert.equal((await res.json()).ticketsCreated, 3);
  const tickets = created();
  assert.deepEqual(
    tickets.map((t) => t.ai_category),
    ["Pricing", "Ranking", "Capacity"]
  );
  assert.ok(tickets.every((t) => t.user_text === VALID.userText && t.urls === tickets[0].urls));
  assert.deepEqual(
    db.calls.filter((c) => c.model === "$transaction").map((c) => c.method),
    ["array"]
  );
});

test("les tickets d'une soumission partagent un submission_group_id, propre à cette soumission", async () => {
  // La route n'en posait aucun jusqu'au 14 octobre 2026 (constat de l'étape 7,
  // corrigé avec l'accord du propriétaire) ; seule la Phase 2 remplissait la
  // colonne.
  await post({ ...VALID, categories: ["Pricing", "Ranking"] });
  await post({ ...VALID, categories: ["Capacity"] });

  const [first, second, third] = created().map((t) => t.submission_group_id);
  assert.equal(typeof first, "string");
  assert.match(first as string, /^[0-9a-f-]{36}$/);
  assert.equal(second, first);
  assert.notEqual(third, first);
});

test("une catégorie répétée ne fait qu'un ticket", async () => {
  const res = await post({ ...VALID, categories: ["Pricing", "Pricing"] });

  assert.equal(res.status, 200);
  assert.equal(created().length, 1);
});

test("une erreur de la base : 500, sans le message interne", async () => {
  withDatabase({
    contributionInbox: {
      create: () => {
        throw new Error("P1001: Can't reach database server at ep-secret-host");
      },
    },
  });
  const original = console.error;
  console.error = () => {};
  try {
    const res = await post(VALID);
    assert.equal(res.status, 500);
    assert.doesNotMatch(await res.text(), /ep-secret-host|P1001/);
  } finally {
    console.error = original;
  }
});

// ── Corps ────────────────────────────────────────────────────────────

test("corps illisible ou qui n'est pas un objet : 400, la base n'est pas lue", async () => {
  for (const body of ['{"schoolId": ', "null", "[]", '"texte"']) {
    const res = await post(body);
    assert.equal(res.status, 400, body);
  }
  assert.deepEqual(db.calls, []);
});

test("schoolId absent, vide ou trop long : 400", async () => {
  await refused({ ...VALID, schoolId: undefined }, /schoolId/);
  await refused({ ...VALID, schoolId: "   " }, /schoolId/);
  await refused({ ...VALID, schoolId: "x".repeat(65) }, /trop long/);
});

// ── Plafonds ─────────────────────────────────────────────────────────

test("catégories : tableau non vide exigé (une chaîne ne fait plus un 500)", async () => {
  await refused({ ...VALID, categories: "Pricing" }, /tableau/);
  await refused({ ...VALID, categories: [] }, /tableau/);
});

test("catégories : plus de 5, inconnue ou réservée au pipeline → 400", async () => {
  await refused(
    { ...VALID, categories: ["Pricing", "Ranking", "Capacity", "SchoolStats", "Accreditation", "Pricing"] },
    /Trop de catégories/
  );
  await refused({ ...VALID, categories: ["Salaires"] }, /Catégorie inconnue/);
  await refused({ ...VALID, categories: ["Program_Discovery"] }, /Catégorie inconnue/);
  await refused({ ...VALID, categories: [42] }, /Catégorie inconnue/);
});

test("les cinq catégories publiques passent", async () => {
  const res = await post({
    ...VALID,
    categories: ["Pricing", "Ranking", "Capacity", "SchoolStats", "Accreditation"],
  });
  assert.equal(res.status, 200);
  assert.equal(created().length, 5);
});

test("URL : tableau non vide, 5 au plus, 2 048 caractères au plus", async () => {
  await refused({ ...VALID, urls: [] }, /urls/);
  await refused({ ...VALID, urls: "https://www.em-normandie.com" }, /urls/);
  await refused({ ...VALID, urls: Array(6).fill(VALID.urls[0]) }, /Maximum 5/);
  await refused(
    { ...VALID, urls: [`https://www.em-normandie.com/${"a".repeat(2048)}`] },
    /trop longue/
  );

  const five = await post({ ...VALID, urls: Array(5).fill(VALID.urls[0]) });
  assert.equal(five.status, 200);
});

test("userText : 2 000 caractères au plus, une chaîne seulement", async () => {
  await refused({ ...VALID, userText: "x".repeat(2001) }, /2000/);
  await refused({ ...VALID, userText: { texte: "objet" } }, /chaîne/);

  const atLimit = await post({ ...VALID, userText: "x".repeat(2000) });
  assert.equal(atLimit.status, 200);
  const absent = await post({ ...VALID, userText: undefined });
  assert.equal(absent.status, 200);
  assert.equal(created().at(-1)?.user_text, "");
});

// ── URL : https, hôte public, domaine de l'école ─────────────────────

test("https seulement", async () => {
  for (const url of [
    "http://www.em-normandie.com/fr/frais",
    "ftp://www.em-normandie.com/frais.pdf",
    "javascript:alert(1)",
    "www.em-normandie.com/fr/frais",
  ]) {
    await refused({ ...VALID, urls: [url] }, /https/);
  }
});

test("hôte interne refusé, avant toute lecture de la base", async () => {
  for (const url of [
    "https://localhost/admin",
    "https://127.0.0.1/",
    "https://10.0.0.12/",
    "https://192.168.1.1/",
    "https://172.20.0.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://100.64.0.1/",
    "https://[::1]/",
    "https://[fd00::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://localhost./",
    "https://intranet.local/",
    "https://db.internal/",
  ]) {
    await refused({ ...VALID, urls: [url] }, /adresse interne/);
  }
  assert.deepEqual(
    db.calls.filter((c) => c.model === "school"),
    []
  );
});

test("domaine : celui de l'école et ses sous-domaines, jamais un sosie", async () => {
  for (const url of [
    "https://em-normandie.com/fr/frais",
    "https://www.em-normandie.com/fr/frais",
    "https://admissions.em-normandie.com/",
    "https://WWW.EM-NORMANDIE.COM/fr/frais",
    "https://www.em-normandie.com:443/fr/frais",
  ]) {
    const res = await post({ ...VALID, urls: [url] });
    assert.equal(res.status, 200, url);
  }

  for (const url of [
    "https://em-normandie.com.evil.net/",
    "https://evil-em-normandie.com/",
    "https://www.letudiant.fr/em-normandie.com",
    "https://evil.net/?r=https://www.em-normandie.com",
  ]) {
    await refused({ ...VALID, urls: [url] }, /domaine officiel/);
  }
});

test("liste blanche CONTRIBUTION_ALLOWED_DOMAINS, en plus du domaine de l'école", async () => {
  process.env.CONTRIBUTION_ALLOWED_DOMAINS = " ft.com , cti-commission.fr ";

  const res = await post({
    ...VALID,
    urls: ["https://rankings.ft.com/schools/em-normandie", "https://www.cti-commission.fr/x"],
  });
  assert.equal(res.status, 200);

  await refused({ ...VALID, urls: ["https://ft.com.evil.net/"] }, /domaine officiel/);
});

// ── L'école et l'appartenance des identifiants ───────────────────────

test("école inconnue ou non ACTIVE : 400, rien d'écrit", async () => {
  withDatabase({ school: { findUnique: () => null } });
  await refused(VALID, /École invalide/);

  withDatabase({ school: { findUnique: () => ({ ...SCHOOL, status: "INACTIVE" }) } });
  await refused(VALID, /École invalide/);
});

test("campus, programme et arête doivent appartenir à l'école", async () => {
  await refused({ ...VALID, campusId: "campus-lyon" }, /campusId/);
  await refused({ ...VALID, campusId: "campus-inconnu" }, /campusId/);
  await refused({ ...VALID, programId: "program-lyon" }, /programId/);
  await refused({ ...VALID, programCampusId: "pc-lyon" }, /programCampusId/);
  await refused({ ...VALID, programCampusId: "pc-inconnu" }, /programCampusId/);
});

test("l'arête doit concorder avec le programme et le campus fournis", async () => {
  await refused(
    { ...VALID, programId: "program-msc", programCampusId: "pc-pge-caen" },
    /programId fourni/
  );
  withDatabase({
    campus: { findUnique: () => ({ schoolId: SCHOOL.id }) },
  });
  await refused(
    { ...VALID, campusId: "campus-paris", programCampusId: "pc-pge-caen" },
    /campusId fourni/
  );
});

test("identifiants de l'école : ils sont écrits sur le ticket", async () => {
  const res = await post({
    ...VALID,
    campusId: "campus-caen",
    programId: "program-pge",
    programCampusId: "pc-pge-caen",
  });

  assert.equal(res.status, 200);
  const [ticket] = created();
  assert.equal(ticket.campusId, "campus-caen");
  assert.equal(ticket.programId, "program-pge");
  assert.equal(ticket.programCampusId, "pc-pge-caen");
});

test("identifiant d'un type inattendu ou trop long : 400", async () => {
  await refused({ ...VALID, campusId: 12 }, /chaîne/);
  await refused({ ...VALID, programId: "p".repeat(65) }, /trop long/);
});
