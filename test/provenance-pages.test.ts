/**
 * test/provenance-pages.test.ts — Les fiches disent d'où vient chaque donnée, et qui l'a modifiée
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 5 : comme le classement le faisait déjà pour sa
 * source, chaque donnée des fiches école et programme montre son lien source
 * et « Modifié par … le … » (D10, D11). Le nom de l'auteur, jamais son
 * adresse ni son identifiant (D25) ; un lien qui n'est pas en http(s) n'est
 * pas cliquable (D27).
 *
 * Les pages sont des composants serveur : on les appelle avec un faux Prisma,
 * puis on rend leur HTML (`renderToStaticMarkup`, sans navigateur). La fiche
 * école est un composant client à onglets : on lit ce qu'elle reçoit, et on
 * rend son en-tête.
 */

import { before, test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import { installFakePrisma } from "./helpers/fake-prisma";
import { schemaErrors } from "./helpers/prisma-schema";

const db = installFakePrisma();

type Page = (props: { params: Promise<Record<string, string>> }) => Promise<ReactElement>;
let ProgramPage: Page;
let SchoolPage: Page;

before(async () => {
  ({ default: ProgramPage } = (await import("../app/schools/[id]/programs/[pid]/page")) as unknown as { default: Page });
  ({ default: SchoolPage } = (await import("../app/schools/[id]/page")) as unknown as { default: Page });
});

const AT = new Date("2026-10-19T08:30:00Z");
const CAMILLE = { display_name: "Camille Martin" };
/** Ce que la base rend d'un auteur ; l'adresse ne doit jamais être lue. */
const by = (via: string, author: { display_name: string | null } = CAMILLE) => ({
  updated_at: AT,
  updated_via: via,
  updated_by_id: "u-camille",
  updatedBy: author,
});
const UNTRACKED = { updated_at: null, updated_via: null, updated_by_id: null, updatedBy: null };

const SCHOOL = {
  id: "school-1",
  name: "Em Normandie",
  official_domain: "em-normandie.com",
  status: "ACTIVE",
  ...by("MANUAL"),
};

const PROGRAM = {
  id: "program-1",
  schoolId: SCHOOL.id,
  name: "Programme Grande École",
  admission_exam: null,
  is_alternance_possible: false,
  is_expatriation_mandatory: false,
  source_url: "https://www.em-normandie.com/fr/pge",
  school: SCHOOL,
  ...by("AI"),
  campuses: [
    {
      id: "pc-1",
      campus: { id: "campus-1", name: "Caen", city: "Caen" },
      capacityRecords: [
        { id: "cap-1", academic_year: 2025, spots_available: 120, source_url: "javascript:alert(1)", ...by("MANUAL", { display_name: null }) },
      ],
    },
  ],
  pricingRecords: [
    {
      id: "pr-1",
      academic_year: 2025,
      currency: "EUR",
      year_1_fee: 16000,
      year_2_fee: null,
      year_3_fee: null,
      year_4_fee: null,
      year_5_fee: null,
      total_fee: 48000,
      intl_year_1_fee: null,
      intl_total_fee: null,
      intl_currency: null,
      additional_fees_notes: null,
      source_url: "https://www.em-normandie.com/fr/tarifs",
      ...by("MANUAL"),
    },
    {
      id: "pr-0",
      academic_year: 2024,
      currency: "EUR",
      year_1_fee: 15000,
      year_2_fee: null,
      year_3_fee: null,
      year_4_fee: null,
      year_5_fee: null,
      total_fee: null,
      intl_year_1_fee: null,
      intl_total_fee: null,
      intl_currency: null,
      additional_fees_notes: null,
      source_url: null,
      ...UNTRACKED,
    },
  ],
  rankingRecords: [
    { id: "rk-1", academic_year: 2025, ranking_name: "Figaro", rank: 9, source_url: "https://etudiant.lefigaro.fr/x", ...by("AI") },
  ],
  // Étape 8 (D16, D51) : les admissions du programme.
  entries: [
    { id: "en-1", entry_year: 1, required_level: 0, route: "PARCOURSUP", note: "Bac général ou technologique", source_url: "https://www.em-normandie.com/fr/pge/admissions", ...by("MANUAL") },
    { id: "en-2", entry_year: 3, required_level: 2, route: "EXAM", note: null, source_url: "javascript:alert(2)", ...UNTRACKED },
  ],
};

const html = (element: ReactElement) => renderToStaticMarkup(element);

/** Chaque `updatedBy` lu ne demande que le nom affiché. */
function assertAuthorSelects() {
  assert.deepEqual(schemaErrors(db.calls), []);
  const text = JSON.stringify(db.calls.map((c) => c.args));
  const selects = [...text.matchAll(/"updatedBy":(\{[^}]*\}\})/g)].map((m) => m[1]);
  assert.ok(selects.length > 0, "l'auteur est lu");
  for (const select of selects) assert.equal(select, '{"select":{"display_name":true}}');
}

test("fiche programme : chaque donnée dit qui l'a modifiée, et quand", async () => {
  db.use({ program: { findUnique: () => PROGRAM } });
  const out = html(await ProgramPage({ params: Promise.resolve({ id: SCHOOL.id, pid: PROGRAM.id }) }));

  assert.match(out, /Validé par Camille Martin le 19 octobre 2026, depuis une recherche IA/, "le programme et le classement");
  assert.match(out, /Modifié par Camille Martin le 19 octobre 2026/, "le tarif");
  assert.match(out, /Modifié par Compte sans nom le 19 octobre 2026/, "la capacité, auteur sans nom");
  assertAuthorSelects();
});

test("fiche programme : les liens source http(s) sont cliquables, les autres non", async () => {
  db.use({ program: { findUnique: () => PROGRAM } });
  const out = html(await ProgramPage({ params: Promise.resolve({ id: SCHOOL.id, pid: PROGRAM.id }) }));

  for (const href of ["https://www.em-normandie.com/fr/pge", "https://www.em-normandie.com/fr/tarifs", "https://etudiant.lefigaro.fr/x"]) {
    assert.match(out, new RegExp(`href="${href.replace(/[.?/]/g, "\\$&")}"[^>]*rel="noopener noreferrer"`), href);
  }
  assert.doesNotMatch(out, /href="javascript:/i);
  assert.doesNotMatch(out, /u-camille|@em-normandie\.fr/, "ni identifiant ni adresse");
});

test("fiche programme : la section « Admissions » dit chaque entrée, sa note, sa source et qui l'a modifiée (D51)", async () => {
  db.use({ program: { findUnique: () => PROGRAM } });
  const out = html(await ProgramPage({ params: Promise.resolve({ id: SCHOOL.id, pid: PROGRAM.id }) }));

  assert.match(out, /id="section-admissions"/);
  assert.match(out, /Entrée en 1re année avec le Bac, par Parcoursup/);
  assert.match(out, /Bac général ou technologique/);
  assert.match(out, /Entrée en 3e année avec un Bac\+2, sur concours/);
  assert.match(out, /href="https:\/\/www\.em-normandie\.com\/fr\/pge\/admissions"[^>]*rel="noopener noreferrer"/);
  assert.doesNotMatch(out, /href="javascript:/i);
  // Les entrées, dans l'ordre de l'année d'entrée, et l'auteur par son nom seul.
  const read = db.calls[0].args[0] as { include: { entries: { orderBy: unknown; include: unknown } } };
  assert.deepEqual(read.include.entries.orderBy, [{ entry_year: "asc" }, { required_level: "asc" }, { route: "asc" }]);
  assertAuthorSelects();
});

test("fiche programme : sans entrée, la section le dit", async () => {
  db.use({ program: { findUnique: () => ({ ...PROGRAM, entries: [] }) } });
  const out = html(await ProgramPage({ params: Promise.resolve({ id: SCHOOL.id, pid: PROGRAM.id }) }));
  assert.match(out, /Aucune donnée d&#x27;admission disponible\./);
});

// Plan gestion-contenu, D74 (contrôle du 21 octobre) : une colonne « Notes »
// tassée à 160 px faisait d'une note longue une ligne de plus de 1 000 px, et
// le tableau débordait de son cadre. La note passe sous les montants de son
// année, sur toute la largeur ; une année et sa note forment un groupe.
test("D74 : la note d'un tarif s'affiche sous ses montants, sur toute la largeur du tableau", async () => {
  const NOTE = "Frais de dossier : 50 EUR ; CVEC en sus.";
  const [withNote, withoutNote] = PROGRAM.pricingRecords;
  db.use({ program: { findUnique: () => ({ ...PROGRAM, pricingRecords: [{ ...withNote, additional_fees_notes: NOTE }, withoutNote] }) } });
  const out = html(await ProgramPage({ params: Promise.resolve({ id: SCHOOL.id, pid: PROGRAM.id }) }));
  const table = out.match(/<table id="pricing-table"[\s\S]*?<\/table>/)?.[0] ?? "";

  assert.doesNotMatch(table, /<th[^>]*>Notes<\/th>/, "plus de colonne « Notes »");
  assert.equal(table.match(/<th[\s>]/g)?.length, 9, "neuf en-têtes (« <thead » non compté)");
  const groups = table.match(/<tbody[\s\S]*?<\/tbody>/g) ?? [];
  assert.equal(groups.length, 2, "un groupe de lignes par année");

  const [first, second] = groups;
  const amounts = first.match(/<tr id="pricing-row-pr-1"[\s\S]*?<\/tr>/)?.[0] ?? "";
  assert.equal(amounts.match(/<td/g)?.length, 9, "l'année, sept montants, la source");
  assert.match(first, /<\/tr><tr id="pricing-notes-pr-1"><td[^>]*colSpan="9"[^>]*>[\s\S]*Notes :[\s\S]*Frais de dossier : 50 EUR ; CVEC en sus\.<\/td><\/tr>/i);
  assert.match(second, /id="pricing-row-pr-0"/);
  assert.doesNotMatch(second, /pricing-notes-/, "sans note, pas de ligne vide");
});

test("fiche école : l'en-tête dit qui a modifié l'école ; chiffres clés et accréditations reçoivent leur provenance", async () => {
  db.use({
    school: {
      findUnique: () => ({
        ...SCHOOL,
        campuses: [],
        programs: [],
        statsRecords: [
          { id: "st-1", academic_year: 2025, total_students: 8000, total_alumni: null, partner_companies: null, annual_internship_offers: null, abroad_campuses: null, partner_universities: null, permanent_professors: null, international_professors_pct: null, external_speakers_pct: null, source_url: "https://www.em-normandie.com/fr/chiffres", ...by("AI") },
        ],
        accreditations: [
          { id: "ac-1", accreditation_name: "EQUIS", accreditation_type: "international", year_obtained: 2015, is_active: true, source_url: "data:text/html,x", ...by("MANUAL") },
        ],
      }),
    },
  });
  const element = await SchoolPage({ params: Promise.resolve({ id: SCHOOL.id }) });
  const school = (element.props as { school: Record<string, unknown> }).school;

  assert.equal(school.provenance, "Modifié par Camille Martin le 19 octobre 2026");
  const [stats] = school.statsRecords as Array<Record<string, unknown>>;
  assert.equal(stats.provenance, "Validé par Camille Martin le 19 octobre 2026, depuis une recherche IA");
  assert.equal(stats.source_href, "https://www.em-normandie.com/fr/chiffres");
  const [accreditation] = school.accreditations as Array<Record<string, unknown>>;
  assert.equal(accreditation.provenance, "Modifié par Camille Martin le 19 octobre 2026");
  assert.equal(accreditation.source_href, null, "un lien data: n'est pas cliquable");

  // Rien de l'auteur ne part vers le navigateur, hors son nom dans le texte.
  assert.doesNotMatch(JSON.stringify(school), /u-camille|updatedBy|updated_by_id/);
  assert.match(html(element), /Modifié par Camille Martin le 19 octobre 2026/);
  assertAuthorSelects();
});
