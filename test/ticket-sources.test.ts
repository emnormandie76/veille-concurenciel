/**
 * test/ticket-sources.test.ts — Trois sources par ticket du pipeline, dans l'inbox
 *
 *     npm run test:ts
 *
 * Tâche hors plan « trois sources » (décisions du propriétaire du 15 octobre
 * 2026, journal du plan backend-local) : le bloc « Sources » d'un ticket
 * `Automated_AI` porte au plus 3 liens, les URL citées par les données, puis le
 * domaine officiel (et la page catalogue en Phase 1, première place), puis
 * l'ordre de Tavily. Le pipeline coupe à l'écriture
 * (backend/pipeline/ticket_sources.py, branche `local`) ; lib/ticket-sources.ts
 * en est le reflet,
 * qui plafonne à l'écran les tickets écrits avant la coupe. Les deux lisent
 * test/fixtures/ticket_sources_cases.json. Sans React ni serveur.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  MAX_TICKET_SOURCES,
  citedUrls,
  displayedTicketSources,
  isOfficialUrl,
  selectTicketSources,
  urlKey,
  type TicketSourcesView,
} from "../lib/ticket-sources";

interface SelectionCase {
  name: string;
  reservoir: unknown[];
  payload: unknown;
  official_domain: string | null;
  priority_urls: unknown[];
  limit: number;
  expected: string[];
}

const doc = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "test", "fixtures", "ticket_sources_cases.json"), "utf-8")
) as {
  cases: SelectionCase[];
  cited: Array<{ name: string; payload: unknown; expected: string[] }>;
  official: Array<{ url: string; official_domain: string | null; official: boolean }>;
  same_url: Array<{ a: string; b: string; same: boolean }>;
};

// ── Les cas partagés avec la suite Python ────────────────────────────

for (const c of doc.cases) {
  test(`cas partagé — ${c.name}`, () => {
    const got = selectTicketSources({
      reservoir: c.reservoir,
      payload: c.payload,
      officialDomain: c.official_domain,
      priorityUrls: c.priority_urls,
      limit: c.limit,
    });
    assert.deepEqual(got, c.expected);
  });
}

test("cas partagés — URL citées, domaine officiel, doublons", () => {
  for (const c of doc.cited) {
    assert.deepEqual(citedUrls(c.payload), c.expected, c.name);
  }
  for (const c of doc.official) {
    assert.equal(isOfficialUrl(c.url, c.official_domain), c.official, `${c.url} | ${c.official_domain}`);
  }
  for (const c of doc.same_url) {
    const a = urlKey(c.a);
    const b = urlKey(c.b);
    assert.ok(a !== null && b !== null, `${c.a} | ${c.b}`);
    assert.equal(a === b, c.same, `${c.a} | ${c.b}`);
  }
  assert.ok(doc.cases.length >= 15 && doc.official.length >= 15 && doc.same_url.length >= 10);
});

test("trois par défaut, sans toucher aux entrées", () => {
  assert.equal(MAX_TICKET_SOURCES, 3);
  const reservoir = Array.from({ length: 12 }, (_, i) => `https://www.letudiant.fr/${i}`);
  const payload = { source_url: "https://www.em-lyon.com/c" };
  const priorityUrls = ["https://www.em-lyon.com/programmes"];
  const got = selectTicketSources({ reservoir, payload, officialDomain: "em-lyon.com", priorityUrls });
  assert.deepEqual(got, ["https://www.em-lyon.com/programmes", "https://www.em-lyon.com/c", reservoir[0]]);
  assert.equal(reservoir.length, 12);
  assert.deepEqual(payload, { source_url: "https://www.em-lyon.com/c" });
  assert.deepEqual(priorityUrls, ["https://www.em-lyon.com/programmes"]);
});

// ── L'affichage de l'inbox ───────────────────────────────────────────

const twelve = doc.cases.find((c) => c.name.includes("douze sources"))!;

function ticket(overrides: Partial<TicketSourcesView>): TicketSourcesView {
  return { source_type: "Automated_AI", urls: [], ai_extracted_json: null, ...overrides };
}

test("inbox : un ticket du pipeline à 12 URL n'en montre que 3", () => {
  const view = ticket({ urls: twelve.reservoir as string[], ai_extracted_json: twelve.payload });
  const shown = displayedTicketSources(view, twelve.official_domain);

  assert.equal(view.urls.length, 12);
  assert.deepEqual(shown, twelve.expected);
});

test("inbox : une contribution du public à 5 URL les montre toutes, dans leur ordre", () => {
  const urls = [
    "https://www.em-lyon.com/fr/accreditations",
    "https://www.letudiant.fr/em-lyon",
    "https://www.em-lyon.com/fr/accreditations",
    "pas une URL",
    "https://www.efmdglobal.org/equis/em-lyon",
  ];
  const view = ticket({
    source_type: "User_Submission",
    urls,
    ai_extracted_json: { accreditations: [{ accreditation_name: "EQUIS", source_url: "https://a.fr/1" }] },
  });

  assert.deepEqual(displayedTicketSources(view, "em-lyon.com"), urls);
});

test("inbox : un ticket déjà coupé à l'écriture s'affiche tel qu'écrit", () => {
  // Relue en base, la charge revient en jsonb : les clés courtes d'abord
  // (`source_urls` avant `discovered_campuses`). Réappliquer la sélection
  // ferait entrer une URL citée que l'écriture n'avait pas retenue.
  const stored = [
    "https://www.essca.eu/programmes",
    "https://www.essca.eu/programmes/msc-01",
    "https://www.essca.eu/programmes/msc-02",
  ];
  const view = ticket({
    urls: stored,
    ai_extracted_json: {
      source_urls: ["https://www.essca.eu/en/10-campuses-around-the-world"],
      discovered_campuses: [
        {
          name: "Campus Paris",
          programs: [
            { name: "MSc 01", source_url: "https://www.essca.eu/programmes/msc-01" },
            { name: "MSc 02", source_url: "https://www.essca.eu/programmes/msc-02" },
            { name: "MSc 03", source_url: "https://www.essca.eu/programmes/msc-03" },
          ],
        },
      ],
    },
  });

  assert.deepEqual(displayedTicketSources(view, "www.essca.eu/"), stored);
});

test("inbox : une découverte d'avant la coupe garde sa page catalogue en tête", () => {
  // Le ticket ESSCA `Program_Discovery` de la branche dev : 28 URL, la page
  // catalogue en premier (la Phase 1 l'a toujours écrite en tête).
  const research = Array.from({ length: 24 }, (_, i) => `https://www.letudiant.fr/essca/${i}`);
  const urls = [
    "https://www.essca.eu/programmes",
    "https://www.essca.eu/programmes/formation-continue",
    "https://www.essca.eu/en/10-campuses-around-the-world",
    "https://www.essca.eu/en/10-campuses-around-the-world/paris",
    ...research,
  ];
  const view = ticket({
    urls,
    ai_extracted_json: {
      source_urls: ["https://www.essca.eu/en/10-campuses-around-the-world/paris"],
      confidence_notes: null,
      diff_against_base: { campuses_known: [] },
      discovered_campuses: Array.from({ length: 11 }, (_, c) => ({
        name: `Campus ${c}`,
        programs: [{ name: `Programme ${c}`, source_url: `https://www.essca.eu/programmes/p${c}` }],
      })),
    },
  });

  assert.equal(urls.length, 28);
  assert.deepEqual(displayedTicketSources(view, "www.essca.eu/"), [
    "https://www.essca.eu/programmes",
    "https://www.essca.eu/en/10-campuses-around-the-world/paris",
    "https://www.essca.eu/programmes/p0",
  ]);
});

test("inbox : un rattachement campus d'avant la coupe n'a pas de place réservée", () => {
  const fiches = ["a", "b", "c", "d"].map((x) => `https://www.em-normandie.com/programmes/${x}`);
  const view = ticket({
    urls: fiches,
    ai_extracted_json: {
      collector: { index_pages: ["https://www.em-normandie.com/programmes"] },
      campus_attachments: [
        { study_year: 1, source_url: fiches[3] },
        { study_year: 2, source_url: fiches[1] },
        { study_year: 3, source_url: fiches[2] },
      ],
      campus_policy_notes: [],
    },
  });

  assert.deepEqual(displayedTicketSources(view, "www.em-normandie.com"), [fiches[3], fiches[1], fiches[2]]);
});

test("inbox : un rapport rangé montre 3 liens, sa liste reste entière", () => {
  const urls = [
    ...Array.from({ length: 10 }, (_, i) => `https://www.letudiant.fr/emlv/${i}`),
    "https://www.emlv.fr/en/ecole-management/campus",
    "https://www.emlv.fr/en/student-life/the-campus",
  ];
  const view = ticket({
    urls,
    ai_extracted_json: { parked_reason: "research_report_parked", last_error: "503", extraction_attempts: 1 },
  });

  assert.deepEqual(displayedTicketSources(view, "emlv.fr"), [urls[10], urls[11], urls[0]]);
  assert.equal(view.urls.length, 12);
});

test("inbox : sans domaine officiel connu, les citées puis l'ordre de Tavily", () => {
  const view = ticket({ urls: twelve.reservoir as string[], ai_extracted_json: twelve.payload });

  assert.deepEqual(displayedTicketSources(view, null), [
    "https://www.em-normandie.com/fr/frais-de-scolarite",
    "https://www.letudiant.fr/etudes/ecole-de-commerce/em-normandie.html",
    "https://www.em-normandie.com/fr/programme-grande-ecole",
  ]);
});

// ── Les branchements ─────────────────────────────────────────────────

const read = (...parts: string[]) => fs.readFileSync(path.join(process.cwd(), ...parts), "utf-8");

test("le bloc « Sources » de l'inbox passe par displayedTicketSources", () => {
  const page = read("app", "admin", "inbox", "page.tsx");

  assert.match(page, /import \{[^}]*displayedTicketSources[^}]*\} from "@\/lib\/ticket-sources"/);
  assert.match(page, /displayedTicketSources\(selectedTicket, selectedTicket\.schoolOfficialDomain/);
  assert.doesNotMatch(page, /selectedTicket\.urls\.map/);
});
