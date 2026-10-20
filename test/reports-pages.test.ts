/**
 * test/reports-pages.test.ts — Les écrans du signalement
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 6 :
 * - D33 : les fiches école et programme portent un lien « Signaler une
 *   information », à leur ancien style, vers la page du formulaire, dans la
 *   charte (`/schools/[id]/report`) ; depuis une fiche programme, le programme
 *   est choisi d'avance. Les fiches ne lisent pas la session (cache ISR) ;
 * - la page du formulaire : toute session (`requirePage("signedIn")`), une
 *   école active seulement, ses campus et programmes pour cible ;
 * - D36 : « Mon compte » montre ses seuls signalements, avec leur état et la
 *   réponse du gestionnaire ;
 * - D31 : la vue des gestionnaires lit et traite par les routes gardées, et
 *   renvoie vers l'onglet de gestion, que l'écran de gestion sait ouvrir
 *   (`?tab=`).
 *
 * Les pages serveur sont appelées avec un faux Prisma et une fausse
 * `requirePage`, puis rendues en HTML (`renderToStaticMarkup`, sans
 * navigateur). Les écrans client qui lisent par `fetch` sont vérifiés par
 * leur source.
 */

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import { installFakePrisma } from "./helpers/fake-prisma";
import { schemaErrors } from "./helpers/prisma-schema";
import { CATEGORY_LABELS, CATEGORY_TABS, REPORT_CATEGORIES } from "../lib/content-reports";

const db = installFakePrisma();

const SESSION = { user: { id: "u-camille", name: "Camille Martin", email: "camille.martin@em-normandie.fr", role: "USER" } };
const levels: string[] = [];
mock.module("@/lib/auth", {
  exports: {
    requirePage: async (level: string) => {
      levels.push(level);
      return SESSION;
    },
  },
});

type Page = (props: { params: Promise<Record<string, string>>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) => Promise<ReactElement>;
let SchoolPage: Page;
let ProgramPage: Page;
let ReportPage: Page;
let AccountPage: () => Promise<ReactElement>;
let MyReports: unknown;

before(async () => {
  ({ default: MyReports } = await import("../app/account/MyReports"));
  ({ default: SchoolPage } = (await import("../app/schools/[id]/page")) as unknown as { default: Page });
  ({ default: ProgramPage } = (await import("../app/schools/[id]/programs/[pid]/page")) as unknown as { default: Page });
  ({ default: ReportPage } = (await import("../app/schools/[id]/report/page")) as unknown as { default: Page });
  ({ default: AccountPage } = (await import("../app/account/page")) as unknown as { default: () => Promise<ReactElement> });
});

beforeEach(() => {
  levels.length = 0;
});

const html = (element: ReactElement) => renderToStaticMarkup(element);
const read = (file: string) => readFileSync(file, "utf8").replace(/\r/g, "");
const UNTRACKED = { updated_at: null, updated_via: null, updated_by_id: null, updatedBy: null, source_url: null };
const SCHOOL = { id: "school-1", name: "Em Normandie", official_domain: "em-normandie.com", status: "ACTIVE", ...UNTRACKED };

// ─── Les fiches : un lien, à l'ancien style (D33) ───────────────────────────

/** Les attributs du lien « Signaler une information », quel que soit leur ordre. */
function reportLink(out: string): string {
  const links = [...out.matchAll(/<a ([^>]*)>Signaler une information<\/a>/g)].map((m) => m[1]);
  assert.equal(links.length, 1, "un seul lien");
  assert.match(links[0], /class="btn btn-secondary"/, "les classes de l'ancien style");
  return links[0];
}

test("fiche école : « Signaler une information » mène au formulaire de l'école", async () => {
  db.use({ school: { findUnique: () => ({ ...SCHOOL, campuses: [], programs: [], statsRecords: [], accreditations: [] }) } });
  const out = html(await SchoolPage({ params: Promise.resolve({ id: SCHOOL.id }) }));
  assert.match(reportLink(out), /href="\/schools\/school-1\/report"/);
});

test("fiche programme : le lien choisit le programme d'avance", async () => {
  db.use({
    program: {
      findUnique: () => ({
        id: "program-1",
        schoolId: SCHOOL.id,
        name: "Programme Grande École",
        admission_exam: null,
        is_alternance_possible: false,
        is_expatriation_mandatory: false,
        school: SCHOOL,
        campuses: [],
        pricingRecords: [],
        rankingRecords: [],
        ...UNTRACKED,
      }),
    },
  });
  const out = html(await ProgramPage({ params: Promise.resolve({ id: SCHOOL.id, pid: "program-1" }) }));
  assert.match(reportLink(out), /href="\/schools\/school-1\/report\?program=program-1"/);
});

test("les fiches ne lisent pas la session et gardent leur cache d'une heure", () => {
  for (const file of ["app/schools/[id]/page.tsx", "app/schools/[id]/SchoolDetailClient.tsx", "app/schools/[id]/programs/[pid]/page.tsx"]) {
    const source = read(file);
    assert.equal(/requirePage|getSession|getServerSession|useSession|@\/components\//.test(source), false, file);
  }
  for (const file of ["app/schools/[id]/page.tsx", "app/schools/[id]/programs/[pid]/page.tsx"]) assert.match(read(file), /export const revalidate = 3600;/, file);
});

// ─── La page du formulaire ──────────────────────────────────────────────────

const WITH_TARGETS = {
  ...SCHOOL,
  campuses: [
    { id: "campus-1", name: "Caen", city: "Caen" },
    { id: "campus-2", name: "Le Havre", city: null },
  ],
  programs: [
    { id: "program-1", name: "Programme Grande École" },
    { id: "program-2", name: "Bachelor in Management" },
  ],
};

function reportPage(searchParams: Record<string, string> = {}, school: unknown = WITH_TARGETS) {
  db.use({ school: { findUnique: () => school } });
  return ReportPage({ params: Promise.resolve({ id: SCHOOL.id }), searchParams: Promise.resolve(searchParams) });
}

test("formulaire : toute session, dans la charte ; l'école, ses campus et ses programmes pour cible", async () => {
  const out = html(await reportPage());
  assert.deepEqual(levels, ["signedIn"]);
  assert.match(out, /class="charte /, "le gabarit de la charte");
  assert.match(out, /<h1[^>]*>Signaler une information<\/h1>/);
  assert.match(out, /Em Normandie/);
  assert.match(out, /<option value="school" selected="">L&#x27;école en général<\/option>/);
  assert.match(out, /<option value="campus:campus-1">Caen \(Caen\)<\/option>/);
  assert.match(out, /<option value="campus:campus-2">Le Havre<\/option>/);
  assert.match(out, /<option value="program:program-2">Bachelor in Management<\/option>/);
  for (const category of REPORT_CATEGORIES) {
    assert.match(out, new RegExp(`<option value="${category}">${CATEGORY_LABELS[category].replace("'", "&#x27;")}</option>`), category);
  }
  assert.match(out, /<textarea[^>]*minLength="10"[^>]*maxLength="2000"|<textarea[^>]*maxLength="2000"[^>]*minLength="10"/);
  assert.match(out, /<input[^>]*type="url"/);
  assert.match(out, /href="\/schools\/school-1"/, "retour à la fiche");
  assert.deepEqual(schemaErrors(db.calls), []);
  const read = db.calls[0].args[0] as { where: unknown };
  assert.deepEqual(read.where, { id: "school-1" });
});

test("formulaire : ?program= choisit le programme ; un programme d'une autre école est ignoré", async () => {
  assert.match(html(await reportPage({ program: "program-2" })), /<option value="program:program-2" selected="">/);
  const other = html(await reportPage({ program: "program-x" }));
  assert.match(other, /<option value="school" selected="">/);
  assert.doesNotMatch(other, /program-x/);
});

test("formulaire : une école inconnue ou inactive n'a pas de formulaire (404)", async () => {
  for (const school of [null, { ...WITH_TARGETS, status: "INACTIVE" }]) {
    await assert.rejects(reportPage({}, school), (err: { digest?: unknown }) => /NEXT_HTTP_ERROR_FALLBACK;404/.test(String(err.digest)));
  }
});

test("formulaire : il envoie à POST /api/admin/reports, sans auteur dans le corps", () => {
  const source = read("app/schools/[id]/report/ReportForm.tsx");
  assert.match(source, /fetch\("\/api\/admin\/reports", \{\s*method: "POST"/);
  assert.equal(/author_id|authorId|handled_by/.test(source), false, "l'auteur vient de la session");
});

// ─── « Mon compte » : vos signalements (D36) ────────────────────────────────

const AT = new Date("2026-10-20T09:15:00Z");
const MINE = [
  {
    id: "report-2",
    schoolId: SCHOOL.id,
    campusId: null,
    programId: null,
    target_type: "PROGRAM",
    target_label: "MSc Supply Chain",
    category: "PRICING",
    status: "RESOLVED",
    response: "Tarif corrigé, merci.",
    created_at: AT,
    handled_at: AT,
    school: { name: "Em Normandie" },
  },
  {
    id: "report-1",
    schoolId: SCHOOL.id,
    campusId: "campus-1",
    programId: null,
    target_type: "CAMPUS",
    target_label: "Caen",
    category: "CAMPUS_PROGRAM",
    status: "OPEN",
    response: null,
    created_at: AT,
    handled_at: null,
    school: { name: "Em Normandie" },
  },
];

/**
 * La section « Vos signalements » de la page : rendue seule, parce que le
 * formulaire du nom (`AccountClient`) demande le routeur de Next.
 */
async function myReports(): Promise<string> {
  const find = (node: unknown): ReactElement | null => {
    if (Array.isArray(node)) return node.map(find).find(Boolean) ?? null;
    if (!node || typeof node !== "object") return null;
    const element = node as ReactElement<{ children?: unknown }>;
    return element.type === MyReports ? element : find(element.props?.children);
  };
  const section = find(await AccountPage());
  assert.ok(section, "la page pose « Vos signalements »");
  return html(section);
}

test("Mon compte : ses seuls signalements, leur état et la réponse ; un programme supprimé garde son nom", async () => {
  db.use({ contentReport: { findMany: () => MINE } });
  const out = await myReports();
  assert.deepEqual(levels, ["signedIn"]);
  const query = db.calls.find((c) => c.model === "contentReport")?.args[0] as { where: unknown; orderBy: unknown; select: Record<string, unknown> };
  assert.deepEqual(query.where, { author_id: "u-camille" }, "les signalements de la session, et eux seuls");
  assert.deepEqual(query.orderBy, { created_at: "desc" });
  assert.equal("handledBy" in query.select || "author" in query.select, false, "ni le nom du gestionnaire ni celui de l'auteur");
  assert.deepEqual(schemaErrors(db.calls), []);

  assert.match(out, /Vos signalements/);
  assert.match(out, /Programme « MSc Supply Chain » \(supprimé\)/);
  assert.match(out, /Campus « Caen »/);
  assert.match(out, />Traité</);
  assert.match(out, />En attente</);
  assert.match(out, /Tarif corrigé, merci\./);
});

test("Mon compte : sans signalement, une phrase le dit", async () => {
  db.use({ contentReport: { findMany: () => [] } });
  assert.match(await myReports(), /Vous n&#x27;avez envoyé aucun signalement/);
});

// ─── La vue des gestionnaires et l'écran de gestion (D31) ───────────────────

test("la vue des gestionnaires lit et décide par les routes gardées, et renvoie vers l'onglet", () => {
  const source = read("app/admin/reports/ReportsManagerClient.tsx");
  assert.match(source, /fetch\("\/api\/admin\/reports"/);
  assert.match(source, /fetch\(`\/api\/admin\/reports\/\$\{[^}]+\}`, \{\s*method: "PATCH"/);
  assert.match(source, /href=\{report\.manage_href\}/);
  assert.match(source, /from "@\/components\/layout\/AdminPage"/);
  assert.equal(/contributionInbox|\/api\/admin\/inbox/.test(source), false, "l'inbox n'est pas touchée");
});

test("l'écran de gestion ouvre l'onglet demandé par ?tab=, s'il existe", () => {
  const source = read("app/admin/schools/[id]/manage/page.tsx");
  assert.match(source, /useSearchParams\(\)/);
  const tabs = [...source.matchAll(/\{ key: "([\w-]+)", label:/g)].map((m) => m[1]);
  assert.equal(tabs.length, 7);
  for (const tab of Object.values(CATEGORY_TABS)) assert.ok(tabs.includes(tab), tab);
});
