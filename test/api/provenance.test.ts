/**
 * test/api/provenance.test.ts — Chaque écriture du contenu dit qui l'a faite, et quand
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 5 (décisions D10, D11, D26) : chaque écriture
 * des neuf tables de données (`School`, `Campus`, `Program`, `PricingRecord`,
 * `CapacityRecord`, `RankingRecord`, `SchoolStatsRecord`,
 * `AccreditationRecord`, `ProgramCampusAttachment`) porte la provenance :
 * `updated_by_id` (le compte de la session, relu en base par lib/auth.ts,
 * jamais le corps de la requête), `updated_at` et `updated_via` (`MANUAL`
 * pour une saisie, `AI` pour une donnée validée depuis l'inbox).
 *
 * Chaque scénario mène une route jusqu'à son écriture, avec un corps qui
 * tente d'imposer un autre auteur. Ce que le test exige :
 * - chaque écriture d'une table suivie porte la provenance de la session,
 *   dans `data`, ou dans `create` et `update` d'un `upsert` ;
 * - une écriture qui ne change rien (l'`update: {}` de create-programs)
 *   reste vide : l'auteur d'un programme déjà là ne bouge pas (D11) ;
 * - les tables non suivies (`ProgramCampus`, `ContributionInbox`) n'en
 *   reçoivent pas ;
 * - après une écriture réussie, suppressions comprises, les fiches et les
 *   routes de l'accueil sont revalidées (D26), et seulement alors.
 */

import { afterEach, before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { installFakePrisma, type FakeModels, type FakePrismaCall } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";
import { body, get, params, quietly } from "../helpers/requests";
import { installSession, type SessionProfile } from "../helpers/session";

const db = installFakePrisma();
const session = installSession();

// `revalidatePath` exige le magasin de rendu de Next : remplacé, il note.
const revalidations: unknown[][] = [];
let revalidationFails = false;
mock.module("next/cache", {
  exports: {
    revalidatePath: (...args: unknown[]) => {
      if (revalidationFails) throw new Error("Invariant: static generation store missing");
      revalidations.push(args);
    },
  },
});

afterEach(() => {
  assert.deepEqual(schemaErrors(db.calls), []);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (request: Request, ctx: { params: Promise<any> }) => Promise<Response>;

const USER_ID: Record<"GESTIONNAIRE" | "ADMIN", string> = {
  GESTIONNAIRE: "test-gestionnaire",
  ADMIN: "test-admin",
};

/** Ce qu'un corps de requête tente d'imposer : jamais écrit. */
const INTRUDER = {
  updated_by_id: "compte-intrus",
  updated_via: "REPORT",
  updated_at: "2000-01-01T00:00:00.000Z",
};

const TRACKED = new Set([
  "school",
  "campus",
  "program",
  "pricingRecord",
  "capacityRecord",
  "rankingRecord",
  "schoolStatsRecord",
  "accreditationRecord",
  "programCampusAttachment",
]);

const PROVENANCE_KEYS = ["updated_by_id", "updated_at", "updated_via"];

const SCHOOL = { id: "school-1", name: "Em Normandie", official_domain: "em-normandie.com", status: "ACTIVE" };
const CAMPUS = { id: "campus-1", schoolId: SCHOOL.id, name: "Caen", city: "Caen" };
const PROGRAM = { id: "program-1", schoolId: SCHOOL.id, name: "PGE" };
const PC = { id: "pc-1", programId: PROGRAM.id, campusId: CAMPUS.id };
const PRICING = { id: "pricing-1", programId: PROGRAM.id, academic_year: 2025, total_fee: 48000 };
const CAPACITY = { id: "capacity-1", programCampusId: PC.id, academic_year: 2025, spots_available: 30 };
const RANKING = { id: "ranking-1", programId: PROGRAM.id, academic_year: 2025, ranking_name: "Figaro", rank: 9 };
const STATS = { id: "stats-1", schoolId: SCHOOL.id, academic_year: 2025, total_students: 8000 };
const ACCREDITATION = {
  id: "accreditation-1",
  schoolId: SCHOOL.id,
  accreditation_name: "EQUIS",
  accreditation_type: "international",
  year_obtained: 2015,
  is_active: true,
};

/** Une écriture rend ce qu'on lui donne, avec un id. */
const echo = (id: string) => (args: { data?: object; create?: object }) => ({ id, ...(args.data ?? args.create ?? {}) });

/** `findUnique` : la ligne par son id, rien par une clé composée (pas de doublon). */
const byId = (row: object) => ({ where }: { where: { id?: string } }) => (where.id ? row : null);

const TICKET_ID = "ticket-1";

/** Un ticket de l'inbox, en attente de l'admin. */
function ticket(category: string, json: unknown, overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET_ID,
    status: "Pending_Admin",
    source_type: "Automated_AI",
    ai_category: category,
    schoolId: SCHOOL.id,
    programId: PROGRAM.id,
    campusId: null,
    programCampusId: null,
    ai_extracted_json: json,
    year_assumed: false,
    data_conflict_warning: false,
    ...overrides,
  };
}

function inbox(row: object): FakeModels["contributionInbox"] {
  return { findUnique: () => row, update: ({ where }: { where: { id: string } }) => ({ id: where.id }) };
}

interface Scenario {
  name: string;
  route: string;
  method: "POST" | "PUT" | "DELETE";
  profile: "GESTIONNAIRE" | "ADMIN";
  via: "MANUAL" | "AI";
  params: Record<string, string>;
  /** Le corps, sans l'intrus (ajouté par le test) ; absent pour DELETE. */
  payload?: Record<string, unknown>;
  url?: string;
  models: FakeModels;
  /** Les écritures suivies attendues, « modèle.méthode ». */
  tracked: string[];
  /** Les `upsert` dont la branche `update` doit rester vide (D11). */
  emptyUpdate?: string[];
}

const PRICING_JSON = { academic_year: 2026, currency: "EUR", total_fee: 43500, source_url: "https://www.em-normandie.com/fr/tarifs" };
const STATS_JSON = { academic_year: 2025, total_students: 9000, source_url: "https://www.em-normandie.com/fr/chiffres" };
const ACCREDITATION_JSON = {
  accreditations: [{ accreditation_name: "AACSB", accreditation_type: "international", source_url: "https://www.em-normandie.com/fr/accreditations" }],
};

const SCENARIOS: Scenario[] = [
  // ── Écoles, campus, programmes (gestionnaire) ──
  {
    name: "créer une école",
    route: "schools/route",
    method: "POST",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: {},
    payload: { name: "EM Lyon", official_domain: "em-lyon.com" },
    models: { school: { findFirst: () => null, create: echo("school-new") } },
    tracked: ["school.create"],
  },
  {
    name: "modifier une école",
    route: "schools/[id]/route",
    method: "PUT",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: SCHOOL.id },
    payload: { name: "EM Normandie" },
    models: { school: { findUnique: () => SCHOOL, findFirst: () => null, update: echo(SCHOOL.id) } },
    tracked: ["school.update"],
  },
  {
    name: "supprimer une école",
    route: "schools/[id]/route",
    method: "DELETE",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: SCHOOL.id },
    url: `http://localhost/x?confirmName=${encodeURIComponent(SCHOOL.name)}`,
    models: { school: { findUnique: () => SCHOOL, delete: () => SCHOOL } },
    tracked: [],
  },
  {
    name: "créer un campus",
    route: "schools/[id]/campuses/route",
    method: "POST",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: SCHOOL.id },
    payload: { name: "Le Havre", city: "Le Havre" },
    models: { school: { findUnique: () => SCHOOL }, campus: { findUnique: () => null, create: echo("campus-new") } },
    tracked: ["campus.create"],
  },
  {
    name: "modifier un campus",
    route: "campuses/[id]/route",
    method: "PUT",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: CAMPUS.id },
    payload: { name: "Caen centre", city: "Caen" },
    models: { campus: { findUnique: byId(CAMPUS), update: echo(CAMPUS.id) } },
    tracked: ["campus.update"],
  },
  {
    name: "supprimer un campus",
    route: "campuses/[id]/route",
    method: "DELETE",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: CAMPUS.id },
    models: { campus: { findUnique: () => CAMPUS, delete: () => CAMPUS } },
    tracked: [],
  },
  {
    name: "créer un programme",
    route: "schools/[id]/programs/route",
    method: "POST",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: SCHOOL.id },
    payload: { name: "MSc Finance", campusIds: [CAMPUS.id] },
    models: {
      school: { findUnique: () => SCHOOL },
      program: { findUnique: () => null, create: echo("program-new") },
      campus: { findMany: () => [{ id: CAMPUS.id }] },
      programCampus: { create: echo("pc-new") },
    },
    tracked: ["program.create"],
  },
  {
    name: "modifier un programme et ses campus",
    route: "programs/[id]/route",
    method: "PUT",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: PROGRAM.id },
    payload: { name: "Programme Grande École", campusIds: [CAMPUS.id] },
    models: {
      program: { findUnique: byId(PROGRAM), update: echo(PROGRAM.id) },
      campus: { findMany: () => [{ id: CAMPUS.id }] },
      programCampus: {
        findMany: () => [{ id: "pc-old", campusId: "campus-old" }],
        deleteMany: () => ({ count: 1 }),
        create: echo("pc-new"),
      },
    },
    tracked: ["program.update"],
  },
  {
    name: "supprimer un programme",
    route: "programs/[id]/route",
    method: "DELETE",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: PROGRAM.id },
    models: { program: { findUnique: () => PROGRAM, delete: () => PROGRAM } },
    tracked: [],
  },
  // ── Tarifs, places, classements ──
  {
    name: "enregistrer un tarif",
    route: "programs/[id]/pricing/route",
    method: "PUT",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: PROGRAM.id },
    payload: { academic_year: 2025, total_fee: 48000, source_url: "https://www.em-normandie.com/fr/tarifs" },
    models: { program: { findUnique: () => PROGRAM }, pricingRecord: { upsert: echo(PRICING.id) } },
    tracked: ["pricingRecord.upsert"],
  },
  {
    name: "supprimer un tarif",
    route: "pricing/[id]/route",
    method: "DELETE",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: PRICING.id },
    models: { pricingRecord: { findUnique: () => PRICING, delete: () => PRICING } },
    tracked: [],
  },
  {
    name: "créer une capacité",
    route: "program-campuses/[id]/capacity/route",
    method: "POST",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: PC.id },
    payload: { spots_available: 30, academic_year: 2025 },
    models: { programCampus: { findUnique: () => PC }, capacityRecord: { findUnique: () => null, create: echo(CAPACITY.id) } },
    tracked: ["capacityRecord.create"],
  },
  {
    name: "modifier une capacité",
    route: "capacities/[id]/route",
    method: "PUT",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: CAPACITY.id },
    payload: { spots_available: 40 },
    models: { capacityRecord: { findUnique: byId(CAPACITY), update: echo(CAPACITY.id) } },
    tracked: ["capacityRecord.update"],
  },
  {
    name: "supprimer une capacité",
    route: "capacities/[id]/route",
    method: "DELETE",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: CAPACITY.id },
    models: { capacityRecord: { findUnique: () => CAPACITY, delete: () => CAPACITY } },
    tracked: [],
  },
  {
    name: "créer un classement",
    route: "programs/[id]/rankings/route",
    method: "POST",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: PROGRAM.id },
    payload: { ranking_name: "Challenges", rank: 12, academic_year: 2025 },
    models: { program: { findUnique: () => PROGRAM }, rankingRecord: { findUnique: () => null, create: echo(RANKING.id) } },
    tracked: ["rankingRecord.create"],
  },
  {
    name: "modifier un classement",
    route: "rankings/[id]/route",
    method: "PUT",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: RANKING.id },
    payload: { rank: 8 },
    models: { rankingRecord: { findUnique: byId(RANKING), update: echo(RANKING.id) } },
    tracked: ["rankingRecord.update"],
  },
  {
    name: "supprimer un classement",
    route: "rankings/[id]/route",
    method: "DELETE",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: RANKING.id },
    models: { rankingRecord: { findUnique: () => RANKING, delete: () => RANKING } },
    tracked: [],
  },
  // ── Chiffres clés, accréditations ──
  {
    name: "enregistrer des chiffres clés",
    route: "schools/[id]/stats/route",
    method: "PUT",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: SCHOOL.id },
    payload: { academic_year: 2025, total_students: 9000 },
    models: { school: { findUnique: () => SCHOOL }, schoolStatsRecord: { upsert: echo(STATS.id) } },
    tracked: ["schoolStatsRecord.upsert"],
  },
  {
    name: "supprimer des chiffres clés",
    route: "schools/[id]/stats/[recordId]/route",
    method: "DELETE",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: SCHOOL.id, recordId: STATS.id },
    models: { schoolStatsRecord: { findUnique: () => STATS, delete: () => STATS } },
    tracked: [],
  },
  {
    name: "créer une accréditation",
    route: "schools/[id]/accreditations/route",
    method: "POST",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: SCHOOL.id },
    payload: { accreditation_name: "AACSB", accreditation_type: "international" },
    models: { school: { findUnique: () => SCHOOL }, accreditationRecord: { findUnique: () => null, create: echo("accreditation-new") } },
    tracked: ["accreditationRecord.create"],
  },
  {
    name: "modifier une accréditation",
    route: "accreditations/[id]/route",
    method: "PUT",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: ACCREDITATION.id },
    payload: { is_active: false },
    models: { accreditationRecord: { findUnique: byId(ACCREDITATION), update: echo(ACCREDITATION.id) } },
    tracked: ["accreditationRecord.update"],
  },
  {
    name: "supprimer une accréditation",
    route: "accreditations/[id]/route",
    method: "DELETE",
    profile: "GESTIONNAIRE",
    via: "MANUAL",
    params: { id: ACCREDITATION.id },
    models: { accreditationRecord: { findUnique: () => ACCREDITATION, delete: () => ACCREDITATION } },
    tracked: [],
  },
  // ── Inbox : le validateur est l'auteur, l'origine est l'IA (D11) ──
  {
    name: "valider une découverte (campus et programmes)",
    route: "inbox/[id]/validate/route",
    method: "PUT",
    profile: "ADMIN",
    via: "AI",
    params: { id: TICKET_ID },
    // Le programme porte une valeur : sa mise à jour écrit, donc elle est
    // signée (une mise à jour vide ne l'est pas : test/provenance.test.ts).
    payload: { discovered_campuses: [{ name: "Caen", city: "Caen", programs: [{ name: "PGE", admission_exam: "SESAME" }] }] },
    models: {
      contributionInbox: inbox(ticket("Program_Discovery", null)),
      campus: { upsert: echo(CAMPUS.id) },
      program: { upsert: echo(PROGRAM.id) },
      programCampus: { upsert: echo(PC.id) },
    },
    tracked: ["campus.upsert", "program.upsert"],
  },
  {
    name: "valider un tarif",
    route: "inbox/[id]/validate/route",
    method: "PUT",
    profile: "ADMIN",
    via: "AI",
    params: { id: TICKET_ID },
    payload: PRICING_JSON,
    models: { contributionInbox: inbox(ticket("Pricing", PRICING_JSON)), pricingRecord: { upsert: echo(PRICING.id) } },
    tracked: ["pricingRecord.upsert"],
  },
  {
    name: "valider un classement",
    route: "inbox/[id]/validate/route",
    method: "PUT",
    profile: "ADMIN",
    via: "AI",
    params: { id: TICKET_ID },
    payload: { rankings: [{ ranking_name: "Figaro", rank: 9, academic_year: 2025 }] },
    models: { contributionInbox: inbox(ticket("Ranking", null)), rankingRecord: { upsert: echo(RANKING.id) } },
    tracked: ["rankingRecord.upsert"],
  },
  {
    name: "valider une capacité",
    route: "inbox/[id]/validate/route",
    method: "PUT",
    profile: "ADMIN",
    via: "AI",
    params: { id: TICKET_ID },
    payload: { spots_available: 30, academic_year: 2025 },
    models: {
      contributionInbox: inbox(ticket("Capacity", null, { programCampusId: PC.id })),
      capacityRecord: { upsert: echo(CAPACITY.id) },
    },
    tracked: ["capacityRecord.upsert"],
  },
  {
    name: "valider des chiffres clés",
    route: "inbox/[id]/validate/route",
    method: "PUT",
    profile: "ADMIN",
    via: "AI",
    params: { id: TICKET_ID },
    payload: STATS_JSON,
    models: { contributionInbox: inbox(ticket("SchoolStats", STATS_JSON)), schoolStatsRecord: { upsert: echo(STATS.id) } },
    tracked: ["schoolStatsRecord.upsert"],
  },
  {
    name: "valider des accréditations",
    route: "inbox/[id]/validate/route",
    method: "PUT",
    profile: "ADMIN",
    via: "AI",
    params: { id: TICKET_ID },
    payload: ACCREDITATION_JSON,
    models: {
      contributionInbox: inbox(ticket("Accreditation", ACCREDITATION_JSON)),
      accreditationRecord: { upsert: echo(ACCREDITATION.id) },
    },
    tracked: ["accreditationRecord.upsert"],
  },
  {
    name: "valider des tarifs multi-programmes",
    route: "inbox/[id]/validate/route",
    method: "PUT",
    profile: "ADMIN",
    via: "AI",
    params: { id: TICKET_ID },
    payload: {
      programs: [
        { extracted_program_name: "PGE", matched_program_id: PROGRAM.id, matched_program_name: "PGE", match_confidence: "exact", data: { academic_year: 2025, total_fee: 1 } },
      ],
    },
    models: { contributionInbox: inbox(ticket("Pricing", null)), pricingRecord: { upsert: echo(PRICING.id) } },
    tracked: ["pricingRecord.upsert"],
  },
  {
    name: "valider des classements multi-programmes",
    route: "inbox/[id]/validate/route",
    method: "PUT",
    profile: "ADMIN",
    via: "AI",
    params: { id: TICKET_ID },
    payload: {
      programs: [
        { extracted_program_name: "PGE", matched_program_id: PROGRAM.id, matched_program_name: "PGE", match_confidence: "exact", data: { ranking_name: "Figaro", rank: 9, academic_year: 2025 } },
      ],
    },
    models: { contributionInbox: inbox(ticket("Ranking", null)), rankingRecord: { upsert: echo(RANKING.id) } },
    tracked: ["rankingRecord.upsert"],
  },
  {
    name: "valider des capacités multi-programmes",
    route: "inbox/[id]/validate/route",
    method: "PUT",
    profile: "ADMIN",
    via: "AI",
    params: { id: TICKET_ID },
    payload: {
      programs: [
        { extracted_program_name: "PGE", matched_program_id: PROGRAM.id, matched_program_name: "PGE", match_confidence: "exact", data: { spots_available: 30, academic_year: 2025 } },
      ],
    },
    models: {
      contributionInbox: inbox(ticket("Capacity", null)),
      programCampus: { findMany: () => [{ ...PC, campus: CAMPUS }] },
      capacityRecord: { upsert: echo(CAPACITY.id) },
    },
    tracked: ["capacityRecord.upsert"],
  },
  {
    name: "écrire des rattachements et une note de campus",
    route: "inbox/[id]/attachments/route",
    method: "PUT",
    profile: "ADMIN",
    via: "AI",
    params: { id: TICKET_ID },
    payload: {
      discovered_campuses: [],
      campus_attachments: [
        { programId: PROGRAM.id, campusId: CAMPUS.id, study_year: 1, regime: "INITIAL", languages: ["fr"], program: "PGE", campus: "Caen", fiche: "https://www.em-normandie.com/fr/pge" },
      ],
      campus_policy_notes: [{ programId: PROGRAM.id, note: "Paris reste accessible chaque année.", program: "PGE", fiche: "https://www.em-normandie.com/fr/pge" }],
    },
    models: {
      contributionInbox: inbox(ticket("Program_Discovery", null)),
      programCampus: { findUnique: () => ({ id: PC.id }) },
      programCampusAttachment: { findMany: () => [], upsert: () => ({ id: "attachment-1" }) },
      program: {
        findUnique: () => ({ id: PROGRAM.id, schoolId: SCHOOL.id, campus_policy_note: null }),
        update: () => ({ id: PROGRAM.id }),
      },
    },
    tracked: ["programCampusAttachment.upsert", "program.update"],
  },
  {
    name: "créer les programmes non rapprochés d'un ticket",
    route: "inbox/[id]/create-programs/route",
    method: "POST",
    profile: "ADMIN",
    via: "AI",
    params: { id: TICKET_ID },
    payload: { programNames: ["MSc Supply Chain"] },
    models: {
      contributionInbox: inbox(
        ticket("Pricing", { programs: [], unmatched_programs: [{ extracted_program_name: "MSc Supply Chain", data: {} }] })
      ),
      program: { upsert: echo("program-new") },
    },
    tracked: ["program.upsert"],
    emptyUpdate: ["program.upsert"],
  },
];

const handlers = new Map<string, Handler>();

before(async () => {
  for (const s of SCENARIOS) {
    const key = `${s.method} ${s.route}`;
    if (handlers.has(key)) continue;
    const mod = (await import(`../../app/api/admin/${s.route}`)) as Record<string, Handler>;
    handlers.set(key, mod[s.method]);
  }
});

beforeEach(() => {
  revalidations.length = 0;
});

function run(s: Scenario): Promise<Response> {
  const handler = handlers.get(`${s.method} ${s.route}`)!;
  const request =
    s.payload === undefined
      ? get(s.url ?? "http://localhost/x", s.method)
      : body({ ...s.payload, ...INTRUDER }, s.method, s.url);
  return quietly(() => handler(request, params(s.params)));
}

/** Les objets écrits par un appel : `data`, ou `create` et `update` d'un upsert. */
function payloads(call: FakePrismaCall): Array<[string, Record<string, unknown>]> {
  const args = (call.args[0] ?? {}) as Record<string, unknown>;
  if (call.method === "upsert") {
    return [
      ["create", args.create as Record<string, unknown>],
      ["update", args.update as Record<string, unknown>],
    ];
  }
  if (call.method === "delete" || call.method === "deleteMany") return [];
  return [["data", (args.data ?? {}) as Record<string, unknown>]];
}

const label = (call: FakePrismaCall) => `${call.model}.${call.method}`;

for (const s of SCENARIOS) {
  test(`${s.name} : la provenance vient de la session (${s.via})`, async () => {
    session.as(s.profile as SessionProfile);
    db.use(s.models);

    const res = await run(s);
    assert.ok(res.status >= 200 && res.status < 300, `${res.status} ${JSON.stringify(await res.clone().json())}`);

    const writes = db.writes();
    const tracked = writes.filter((c) => TRACKED.has(c.model) && c.method !== "delete" && c.method !== "deleteMany");
    assert.deepEqual([...new Set(tracked.map(label))].sort(), [...s.tracked].sort(), "écritures suivies");

    for (const call of tracked) {
      for (const [branch, data] of payloads(call)) {
        if (branch === "update" && s.emptyUpdate?.includes(label(call))) {
          assert.deepEqual(data, {}, `${label(call)}.update : une écriture qui ne change rien garde son auteur`);
          continue;
        }
        assert.equal(data.updated_by_id, USER_ID[s.profile], `${label(call)}.${branch} : l'auteur est la session`);
        assert.equal(data.updated_via, s.via, `${label(call)}.${branch} : l'origine`);
        assert.ok(data.updated_at instanceof Date, `${label(call)}.${branch} : la date est posée par le serveur`);
        assert.ok(Date.now() - (data.updated_at as Date).getTime() < 60_000, `${label(call)}.${branch} : la date est celle de l'écriture`);
      }
    }

    for (const call of writes.filter((c) => !TRACKED.has(c.model))) {
      for (const [branch, data] of payloads(call)) {
        for (const key of PROVENANCE_KEYS) {
          assert.equal(key in (data ?? {}), false, `${label(call)}.${branch} : table non suivie, pas de ${key}`);
        }
      }
    }

    assert.deepEqual(
      revalidations,
      [
        ["/schools", "layout"],
        ["/api/schools", "layout"],
      ],
      "les fiches et les routes de l'accueil sont revalidées une fois"
    );
  });
}

test("chaque écriture du contenu a son scénario", () => {
  // Relevé du 19 octobre 2026 : 29 appels d'écriture dans 25 handlers
  // (22 du contenu, 3 de l'inbox), 33 scénarios. Une route d'écriture
  // ajoutée sans scénario fait tomber ce décompte.
  assert.equal(SCENARIOS.length, 33);
  assert.equal(new Set(SCENARIOS.map((s) => `${s.method} ${s.route}`)).size, 25);
});

test("une écriture refusée ne revalide rien", async () => {
  session.as("GESTIONNAIRE");
  db.use({});
  const createSchool = handlers.get("POST schools/route")!;
  const res = await createSchool(body({ name: "  ", official_domain: "" }), params({}));
  assert.equal(res.status, 400);
  assert.deepEqual(revalidations, []);
});

test("une revalidation qui échoue n'annule pas l'écriture (D26)", async () => {
  session.as("GESTIONNAIRE");
  db.use({ school: { findFirst: () => null, create: echo("school-new") } });
  revalidationFails = true;
  try {
    const res = await quietly(() => handlers.get("POST schools/route")!(body({ name: "EM Lyon", official_domain: "em-lyon.com" }), params({})));
    assert.equal(res.status, 201);
    assert.equal(db.writes().length, 1);
  } finally {
    revalidationFails = false;
  }
});
