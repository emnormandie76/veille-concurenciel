/**
 * test/campus-attachment.test.ts — Le module d'écriture, prouvé sans base
 *
 *     npm run test:ts
 *
 * Pourquoi ces tests existent et ce qu'ils prouvent que la base ne peut pas
 * prouver aujourd'hui : la migration `20260904120000_program_campus_attachment`
 * n'est PAS appliquée, donc `ProgramCampusAttachment` n'existe pas dans Neon et
 * tout appel qui la vise échoue en `P2021`. Ce qui touche la table est donc
 * prouvé ici, contre un double qui enregistre chaque appel — et sur les
 * IDENTIFIANTS RÉELS de la base, recopiés du dump lecture seule comme
 * `test_program_identity.py` recopie les noms réels.
 *
 * Ce qui EXISTE en base — la résolution des arêtes par `findUnique` sur
 * `programId_campusId` — est prouvé ailleurs, contre la vraie base, dans une
 * transaction volontairement annulée : `tmp/probe_attachment_write.ts`.
 *
 * Le double n'expose que les trois appels déclarés par `AttachmentTx`. Toute
 * autre méthode lève : c'est la preuve, à l'exécution et non par relecture, que
 * ce chemin ne crée ni ne supprime aucune arête `ProgramCampus`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  applyAttachmentPlan,
  applyPolicyNotePlan,
  foldAttachmentClaims,
  foldPolicyNoteClaims,
  hasCampusAttachmentBlock,
  planAttachmentWrites,
  planPolicyNoteWrites,
  readExistingAttachments,
  resolveAttachmentEdges,
  resolvePolicyNotePrograms,
  type AttachmentTx,
  type ExistingAttachment,
  type PolicyNoteTx,
} from "../lib/campus-attachment";
import { provenance } from "../lib/provenance";

// Toute écriture porte la provenance de l'admin qui valide (plan
// gestion-contenu, étape 5, D11) ; test/api/provenance.test.ts la vérifie.
const STAMP = provenance("u-admin", "AI", new Date("2026-10-19T08:30:00Z"));

// ── Identifiants réels, recopiés de la base (Em Normandie) ────────────────
const P_BM = "38dd257f-e501-47d2-8e0b-71af000106cc"; // Bachelor Management
const P_PGE = "91b64058-6b59-418c-ab2a-09db24372b1e"; // Programme Grande École
const P_IBBA = "160d91e0-df52-4f98-bf15-eafba3417bd8"; // International Bachelor…

const C_CAEN = "7ad83de9-4451-458e-a04e-dc85fddf70d1";
const C_DUBAI = "2e803127-a3c5-4ba5-83e4-d3cbe0f3215c";
const C_DUBLIN = "d05bf2a8-bc11-4d94-bd19-f2d91bfba82f";
const C_LE_HAVRE = "9909ac50-c040-4938-af47-30d2cce6928e";
const C_OXFORD = "3c8c2a98-4abc-4d90-9bf5-545a0e5ec9fe";
const C_PARIS = "31110ebd-7f81-4413-b74d-54a439454bbb";

/**
 * Les arêtes `ProgramCampus` réellement en base, recopiées du dump. Les deux
 * absences sont réelles : le Bachelor Management n'a que Le Havre et Paris.
 */
const EDGES: Record<string, string> = {
  [`${P_BM} ${C_LE_HAVRE}`]: "59e188e5-0ef1-4c4c-95e6-753e91d822ef",
  [`${P_BM} ${C_PARIS}`]: "b26beb3d-610f-431e-ba14-8c5b995fba93",
  [`${P_PGE} ${C_CAEN}`]: "3f51b008-6a03-4012-beaf-f6f79e7dad7e",
  [`${P_PGE} ${C_DUBAI}`]: "3c863d01-f77c-41e2-8132-8f8adc2c4cbf",
  [`${P_PGE} ${C_DUBLIN}`]: "ee49f6ce-66f0-4f3b-9620-8597a92cd262",
  [`${P_PGE} ${C_LE_HAVRE}`]: "82a9c1d8-4b04-4290-93a0-6286e1c45185",
  [`${P_PGE} ${C_OXFORD}`]: "d0cf9b5b-86bc-4cf1-a37c-9cf3824324ba",
  [`${P_PGE} ${C_PARIS}`]: "fa6825e4-0167-4968-a9c0-3e7cc7e559ad",
  [`${P_IBBA} ${C_DUBAI}`]: "a63f6804-eb2c-492f-b65a-876b1ef92dec",
  [`${P_IBBA} ${C_DUBLIN}`]: "0a2e0004-6052-49d5-8153-15b3f4c17941",
  [`${P_IBBA} ${C_OXFORD}`]: "bc0bbb47-be92-4e09-9176-e68ebdb84bc9",
  [`${P_IBBA} ${C_PARIS}`]: "5a7e2815-b22e-42b7-8801-7c1cfc5271fe",
};

const F_BM3 = "Bachelor en Management en 3 ans";
const F_IBBA = "IBBA (International Bachelor in Business Administration)";
const F_PGE5 = "Programme Grande École en 5 ans";
const F_PGE23 = "Programme Grande École en 2 ou 3 ans";

const PROGRAM_LABEL: Record<string, string> = {
  [P_BM]: "Bachelor Management",
  [P_PGE]: "Programme Grande École",
  [P_IBBA]: "International Bachelor in Business Administration",
};
const CAMPUS_LABEL: Record<string, string> = {
  [C_CAEN]: "Caen",
  [C_DUBAI]: "Dubaï",
  [C_DUBLIN]: "Dublin",
  [C_LE_HAVRE]: "Le Havre",
  [C_OXFORD]: "Oxford",
  [C_PARIS]: "Paris",
};
const SOURCE: Record<string, string> = {
  [F_BM3]: "https://www.em-normandie.com/programmes/bachelor-management/bachelor-en-management-en-3-ans",
  [F_IBBA]:
    "https://www.em-normandie.com/programmes/international-bachelor-business-administration/ibba-international-bachelor-business-administration",
  [F_PGE5]:
    "https://www.em-normandie.com/programmes/programme-grande-ecole/programme-grande-ecole-en-5-ans",
  [F_PGE23]:
    "https://www.em-normandie.com/programmes/programme-grande-ecole/programme-grande-ecole-en-2-ou-3-ans",
};

function claim(
  programId: string,
  campusId: string,
  study_year: number,
  regime: string,
  languages: string[],
  fiche: string
) {
  return {
    programId,
    campusId,
    program: PROGRAM_LABEL[programId],
    campus: CAMPUS_LABEL[campusId],
    fiche,
    study_year,
    regime,
    languages,
    note: null,
    source_url: SOURCE[fiche],
  };
}

/**
 * Les 33 lignes-années du 4 septembre 2026, telles que le collecteur les rend
 * après les deux gardes de page. Quatre fiches sur quarante-neuf.
 */
const CORPUS = [
  claim(P_BM, C_CAEN, 3, "ALTERNANCE", ["FR"], F_BM3),
  claim(P_BM, C_DUBLIN, 2, "ANY", ["EN"], F_BM3),
  claim(P_BM, C_LE_HAVRE, 1, "ANY", ["EN", "FR"], F_BM3),
  claim(P_BM, C_LE_HAVRE, 2, "ANY", ["EN", "FR"], F_BM3),
  claim(P_BM, C_LE_HAVRE, 3, "ALTERNANCE", ["FR"], F_BM3),
  claim(P_BM, C_LE_HAVRE, 3, "INITIAL", ["EN", "FR"], F_BM3),
  claim(P_BM, C_PARIS, 1, "ANY", ["FR"], F_BM3),
  claim(P_BM, C_PARIS, 2, "ANY", ["FR"], F_BM3),
  claim(P_BM, C_PARIS, 3, "ALTERNANCE", ["FR"], F_BM3),
  claim(P_IBBA, C_DUBAI, 3, "ANY", ["EN"], F_IBBA),
  claim(P_IBBA, C_DUBLIN, 2, "ANY", ["EN"], F_IBBA),
  claim(P_IBBA, C_OXFORD, 4, "ANY", ["EN"], F_IBBA),
  claim(P_IBBA, C_PARIS, 1, "ANY", ["EN"], F_IBBA),
  claim(P_PGE, C_CAEN, 1, "ANY", ["EN", "FR"], F_PGE5),
  claim(P_PGE, C_CAEN, 2, "ANY", ["EN", "FR"], F_PGE5),
  claim(P_PGE, C_CAEN, 3, "ANY", ["EN", "FR"], F_PGE5),
  claim(P_PGE, C_DUBAI, 1, "ANY", ["EN"], F_PGE5),
  claim(P_PGE, C_DUBAI, 2, "ANY", ["EN"], F_PGE5),
  claim(P_PGE, C_DUBAI, 3, "ANY", ["EN"], F_PGE5),
  claim(P_PGE, C_DUBLIN, 1, "ANY", ["EN"], F_PGE5),
  claim(P_PGE, C_DUBLIN, 2, "ANY", ["EN"], F_PGE5),
  claim(P_PGE, C_DUBLIN, 3, "ANY", ["EN"], F_PGE5),
  claim(P_PGE, C_OXFORD, 1, "ANY", ["EN"], F_PGE5),
  claim(P_PGE, C_OXFORD, 2, "ANY", ["EN"], F_PGE5),
  claim(P_PGE, C_OXFORD, 3, "ANY", ["EN"], F_PGE5),
  claim(P_PGE, C_PARIS, 1, "ANY", ["EN", "FR"], F_PGE5),
  claim(P_PGE, C_PARIS, 2, "ANY", ["EN", "FR"], F_PGE5),
  claim(P_PGE, C_PARIS, 3, "ANY", ["EN", "FR"], F_PGE5),
  claim(P_PGE, C_CAEN, 3, "ANY", ["EN", "FR"], F_PGE23),
  claim(P_PGE, C_DUBAI, 3, "ANY", ["EN"], F_PGE23),
  claim(P_PGE, C_DUBLIN, 3, "ANY", ["EN"], F_PGE23),
  claim(P_PGE, C_OXFORD, 3, "ANY", ["EN"], F_PGE23),
  claim(P_PGE, C_PARIS, 3, "ANY", ["EN", "FR"], F_PGE23),
];

// ── Le double de client transactionnel ───────────────────────────────────
//
// Il n'implémente QUE les trois appels de `AttachmentTx`. `programCampus` est
// derrière un Proxy qui lève sur toute autre propriété : si le module tentait
// un jour `create`, `upsert` ou `deleteMany` sur une arête, chaque test
// tomberait.

interface Recorder {
  tx: AttachmentTx;
  calls: string[];
  rows: ExistingAttachment[];
}

function fakeTx(existing: ExistingAttachment[] = []): Recorder {
  const calls: string[] = [];
  const rows = existing.map((r) => ({ ...r }));
  let nextId = rows.length + 1;

  const programCampus = new Proxy(
    {
      findUnique(args: {
        where: { programId_campusId: { programId: string; campusId: string } };
      }) {
        const { programId, campusId } = args.where.programId_campusId;
        calls.push(`programCampus.findUnique ${programId} ${campusId}`);
        const id = EDGES[`${programId} ${campusId}`];
        return Promise.resolve(id ? { id } : null);
      },
    },
    {
      get(target, prop, receiver) {
        if (prop !== "findUnique") {
          throw new Error(
            `programCampus.${String(prop)} appelé : ce chemin ne doit toucher aucune arête`
          );
        }
        return Reflect.get(target, prop, receiver);
      },
    }
  ) as AttachmentTx["programCampus"];

  const tx: AttachmentTx = {
    programCampus,
    programCampusAttachment: {
      findMany(args) {
        calls.push(`attachment.findMany ${args.where.programCampusId.in.length} aretes`);
        return Promise.resolve(
          rows.filter((r) => args.where.programCampusId.in.includes(r.programCampusId)).map((r) => ({ ...r }))
        );
      },
      upsert(args) {
        const k = args.where.programCampusId_study_year_regime;
        calls.push(`attachment.upsert ${k.programCampusId} ${k.study_year} ${k.regime}`);
        const found = rows.find(
          (r) =>
            r.programCampusId === k.programCampusId &&
            r.study_year === k.study_year &&
            r.regime === k.regime
        );
        if (found) {
          found.languages = args.update.languages;
          found.note = args.update.note;
          found.source_url = args.update.source_url;
          return Promise.resolve({ id: found.id });
        }
        const created = { id: `row-${nextId++}`, ...args.create };
        rows.push(created);
        return Promise.resolve({ id: created.id });
      },
    },
  };

  return { tx, calls, rows };
}

/** Le chemin complet de la route, sans Next ni Prisma. */
async function runPass(raw: unknown, existing: ExistingAttachment[] = []) {
  const rec = fakeTx(existing);
  const folded = foldAttachmentClaims(raw);
  const { resolved, conflicts: edgeConflicts } = await resolveAttachmentEdges(rec.tx, folded.claims);
  const rowsBefore = await readExistingAttachments(rec.tx, resolved);
  const plan = planAttachmentWrites(resolved, rowsBefore);
  const counts = await applyAttachmentPlan(rec.tx, plan, STAMP);
  return {
    plan,
    counts,
    conflicts: [...folded.conflicts, ...edgeConflicts, ...plan.conflicts],
    calls: rec.calls,
    rows: rec.rows,
  };
}

function countBy(rows: Array<{ type: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[row.type] = (out[row.type] ?? 0) + 1;
  return out;
}

function signature(plan: { create: Array<{ programCampusId: string }> }) {
  return plan.create.map((w) => w.programCampusId).length;
}

// ── Le corpus réel ───────────────────────────────────────────────────────

test("les 33 affirmations du corpus donnent 26 lignes, 5 fusions et 2 refus", async () => {
  const out = await runPass({ campus_attachments: CORPUS });

  assert.equal(out.plan.create.length, 26);
  assert.equal(out.plan.update.length, 0);
  assert.equal(out.plan.unchanged.length, 0);
  assert.equal(out.counts.created, 26);
  assert.deepEqual(countBy(out.conflicts), { merged_tracks: 5, edge_missing: 2 });
  // 33 lignes, 13 couples (programme, campus) distincts : une seule
  // interrogation par couple, pas une par ligne.
  assert.equal(out.calls.filter((c) => c.startsWith("programCampus.findUnique")).length, 13);
});

test("les 26 lignes, une par une", async () => {
  const out = await runPass({ campus_attachments: CORPUS });
  const written = out.plan.create
    .map((w) => `${w.program} | ${w.campus} | ${w.study_year} | ${w.regime} | ${w.languages.join("+")}`)
    .sort();

  assert.deepEqual(written, [
    "Bachelor Management | Le Havre | 1 | ANY | EN+FR",
    "Bachelor Management | Le Havre | 2 | ANY | EN+FR",
    "Bachelor Management | Le Havre | 3 | ALTERNANCE | FR",
    "Bachelor Management | Le Havre | 3 | INITIAL | EN+FR",
    "Bachelor Management | Paris | 1 | ANY | FR",
    "Bachelor Management | Paris | 2 | ANY | FR",
    "Bachelor Management | Paris | 3 | ALTERNANCE | FR",
    "International Bachelor in Business Administration | Dubaï | 3 | ANY | EN",
    "International Bachelor in Business Administration | Dublin | 2 | ANY | EN",
    "International Bachelor in Business Administration | Oxford | 4 | ANY | EN",
    "International Bachelor in Business Administration | Paris | 1 | ANY | EN",
    "Programme Grande École | Caen | 1 | ANY | EN+FR",
    "Programme Grande École | Caen | 2 | ANY | EN+FR",
    "Programme Grande École | Caen | 3 | ANY | EN+FR",
    "Programme Grande École | Dubaï | 1 | ANY | EN",
    "Programme Grande École | Dubaï | 2 | ANY | EN",
    "Programme Grande École | Dubaï | 3 | ANY | EN",
    "Programme Grande École | Dublin | 1 | ANY | EN",
    "Programme Grande École | Dublin | 2 | ANY | EN",
    "Programme Grande École | Dublin | 3 | ANY | EN",
    "Programme Grande École | Oxford | 1 | ANY | EN",
    "Programme Grande École | Oxford | 2 | ANY | EN",
    "Programme Grande École | Oxford | 3 | ANY | EN",
    "Programme Grande École | Paris | 1 | ANY | EN+FR",
    "Programme Grande École | Paris | 2 | ANY | EN+FR",
    "Programme Grande École | Paris | 3 | ANY | EN+FR",
  ]);
});

test("aucune arête n'est créée : le journal ne contient que findUnique sur ProgramCampus", async () => {
  const out = await runPass({ campus_attachments: CORPUS });
  const forbidden = out.calls.filter(
    (c) => c.startsWith("programCampus.") && !c.startsWith("programCampus.findUnique")
  );
  assert.deepEqual(forbidden, []);
  // Et le double lève de lui-même si le module tentait autre chose.
  const rec = fakeTx();
  assert.throws(
    () => (rec.tx.programCampus as unknown as Record<string, unknown>).create,
    /ne doit toucher aucune arête/
  );
});

test("edge_missing nomme les deux lignes que la base ne porte pas", async () => {
  const out = await runPass({ campus_attachments: CORPUS });
  const missing = out.conflicts
    .filter((c) => c.type === "edge_missing")
    .map((c) => `${c.program} + ${c.campus} (année ${c.study_year}, ${c.regime})`)
    .sort();

  assert.deepEqual(missing, [
    "Bachelor Management + Caen (année 3, ALTERNANCE)",
    "Bachelor Management + Dublin (année 2, ANY)",
  ]);
});

test("merged_tracks : les cinq clés d'année 3 du PGE font une ligne chacune", async () => {
  const out = await runPass({ campus_attachments: CORPUS });
  const merged = out.conflicts.filter((c) => c.type === "merged_tracks");

  assert.equal(merged.length, 5);
  for (const conflict of merged) {
    assert.equal(conflict.study_year, 3);
    assert.deepEqual(conflict.fiches, [F_PGE23, F_PGE5]);
  }
  assert.deepEqual(
    merged.map((c) => c.campus).sort(),
    ["Caen", "Dubaï", "Dublin", "Oxford", "Paris"]
  );
  // Et une seule ligne écrite pour chacune de ces clés.
  const pgeYear3 = out.plan.create.filter((w) => w.program === "Programme Grande École" && w.study_year === 3);
  assert.equal(pgeYear3.length, 5);
});

test("le source_url d'une fusion est déterministe et ne dépend pas de l'ordre de lecture", async () => {
  const straight = await runPass({ campus_attachments: CORPUS });
  const reversed = await runPass({ campus_attachments: [...CORPUS].reverse() });

  const key = (w: { programCampusId: string; study_year: number; regime: string; source_url: string | null }) =>
    `${w.programCampusId} ${w.study_year} ${w.regime} ${w.source_url}`;
  assert.deepEqual(straight.plan.create.map(key).sort(), reversed.plan.create.map(key).sort());
});

// ── Les gardes que le corpus n'exerce pas ────────────────────────────────

test("track_disagreement : deux fiches qui divergent n'écrivent rien", async () => {
  const a = claim(P_PGE, C_PARIS, 3, "ANY", ["EN", "FR"], F_PGE5);
  const b = { ...claim(P_PGE, C_PARIS, 3, "ANY", ["EN"], F_PGE23) };
  const out = await runPass({ campus_attachments: [a, b] });

  assert.equal(out.plan.create.length, 0);
  assert.equal(out.counts.created, 0);
  const conflict = out.conflicts.find((c) => c.type === "track_disagreement");
  assert.ok(conflict);
  assert.deepEqual(conflict.fiches, [F_PGE23, F_PGE5]);
  assert.deepEqual(
    conflict.versions?.map((v) => v.languages),
    [["EN", "FR"], ["EN"]]
  );
  assert.equal(out.calls.filter((c) => c.startsWith("attachment.upsert")).length, 0);
});

test("absorption ANY / régime nommé : la ligne ANY disparaît, ses langues sont versées", async () => {
  const anyRow = claim(P_BM, C_LE_HAVRE, 3, "ANY", ["FR"], F_BM3);
  const initial = claim(P_BM, C_LE_HAVRE, 3, "INITIAL", ["EN"], F_BM3);
  const out = await runPass({ campus_attachments: [anyRow, initial] });

  assert.equal(out.plan.create.length, 1);
  assert.equal(out.plan.create[0].regime, "INITIAL");
  assert.deepEqual(out.plan.create[0].languages, ["EN", "FR"]);
  assert.ok(out.conflicts.some((c) => c.type === "absorbed_any"));
});

test("regime_conflict : la production porte déjà le genre opposé sur cette année", async () => {
  const edge = EDGES[`${P_BM} ${C_PARIS}`];
  const existing: ExistingAttachment[] = [
    {
      id: "row-existante",
      programCampusId: edge,
      study_year: 1,
      regime: "INITIAL",
      languages: ["FR"],
      note: null,
      source_url: null,
    },
  ];
  const out = await runPass(
    { campus_attachments: [claim(P_BM, C_PARIS, 1, "ANY", ["FR"], F_BM3)] },
    existing
  );

  assert.equal(out.plan.create.length, 0);
  assert.equal(out.calls.filter((c) => c.startsWith("attachment.upsert")).length, 0);
  const conflict = out.conflicts.find((c) => c.type === "regime_conflict");
  assert.ok(conflict);
  assert.match(conflict.effect, /ne supprime pas/);
});

// ── La deuxième passe ────────────────────────────────────────────────────

test("deuxième passe, ligne identique : unchanged, aucun upsert émis", async () => {
  const first = await runPass({ campus_attachments: CORPUS });
  const second = await runPass({ campus_attachments: CORPUS }, first.rows);

  assert.equal(second.plan.create.length, 0);
  assert.equal(second.plan.update.length, 0);
  assert.equal(second.plan.unchanged.length, 26);
  assert.equal(second.calls.filter((c) => c.startsWith("attachment.upsert")).length, 0);
  assert.equal(second.plan.stale.length, 0);
});

test("deuxième passe, langues changées : update, et l'avant est rendu à l'admin", async () => {
  const first = await runPass({ campus_attachments: CORPUS });
  const moved = CORPUS.map((c) =>
    c.programId === P_BM && c.campusId === C_PARIS && c.study_year === 1
      ? { ...c, languages: ["EN", "FR"] }
      : c
  );
  const second = await runPass({ campus_attachments: moved }, first.rows);

  assert.equal(second.plan.update.length, 1);
  assert.equal(second.plan.unchanged.length, 25);
  const [update] = second.plan.update;
  assert.deepEqual(update.before?.languages, ["FR"]);
  assert.deepEqual(update.languages, ["EN", "FR"]);
  assert.equal(second.calls.filter((c) => c.startsWith("attachment.upsert")).length, 1);
});

test("deuxième passe, ligne que la page ne publie plus : stale, jamais supprimée", async () => {
  const first = await runPass({ campus_attachments: CORPUS });
  const shrunk = CORPUS.filter(
    (c) => !(c.programId === P_BM && c.campusId === C_LE_HAVRE && c.study_year === 2)
  );
  const second = await runPass({ campus_attachments: shrunk }, first.rows);

  assert.equal(second.plan.stale.length, 1);
  const [stale] = second.plan.stale;
  assert.equal(stale.campus, "Le Havre");
  assert.equal(stale.study_year, 2);
  // La ligne est toujours là après la passe : rien n'a été supprimé.
  assert.equal(second.rows.length, 26);
  assert.ok(
    second.rows.some((r) => r.programCampusId === stale.programCampusId && r.study_year === 2)
  );
});

test("une arête que la passe ne touche pas ne produit aucun stale", async () => {
  const first = await runPass({ campus_attachments: CORPUS });
  const onlyIbba = CORPUS.filter((c) => c.programId === P_IBBA);
  const second = await runPass({ campus_attachments: onlyIbba }, first.rows);

  assert.equal(second.plan.unchanged.length, 4);
  assert.equal(second.plan.stale.length, 0);
});

test("rejouer le même lot est idempotent : aucune écriture la seconde fois", async () => {
  const first = await runPass({ campus_attachments: CORPUS });
  const second = await runPass({ campus_attachments: CORPUS }, first.rows);
  const third = await runPass({ campus_attachments: CORPUS }, second.rows);

  assert.equal(first.rows.length, 26);
  assert.equal(second.rows.length, 26);
  assert.equal(third.rows.length, 26);
  assert.equal(third.calls.filter((c) => c.startsWith("attachment.upsert")).length, 0);
});

// ── Les refus de lecture ─────────────────────────────────────────────────

test("une entrée sans programId est refusée, jamais devinée par son libellé", async () => {
  const out = await runPass({
    campus_attachments: [{ ...claim(P_BM, C_PARIS, 1, "ANY", ["FR"], F_BM3), programId: null }],
  });

  assert.equal(out.plan.create.length, 0);
  const conflict = out.conflicts.find((c) => c.type === "unresolved_reference");
  assert.ok(conflict);
  assert.match(conflict.effect, /ne rapproche pas les noms/);
});

test("study_year 0 est refusé : c'est la sentinelle de ProgramPlacement", async () => {
  const out = await runPass({
    campus_attachments: [claim(P_BM, C_PARIS, 0, "ANY", ["FR"], F_BM3)],
  });

  assert.equal(out.plan.create.length, 0);
  assert.equal(countBy(out.conflicts).malformed_row, 1);
});

test("un régime hors ANY | INITIAL | ALTERNANCE est refusé", async () => {
  const out = await runPass({
    campus_attachments: [claim(P_BM, C_PARIS, 1, "CONTINUE", ["FR"], F_BM3)],
  });

  assert.equal(out.plan.create.length, 0);
  assert.equal(countBy(out.conflicts).malformed_row, 1);
});

test("un ticket sans bloc campus_attachments ne produit rien et ne lève pas", async () => {
  const out = await runPass({ discovered_campuses: [] });

  assert.equal(signature(out.plan), 0);
  assert.deepEqual(out.conflicts, []);
  assert.deepEqual(out.calls, []);
});

// ── Les cas partagés avec la suite Python ────────────────────────────────
//
// `backend/pipeline/attachment_plan.py` porte ce plan en Python : la Phase 1
// doit savoir si un ticket a quelque chose à écrire avant de le déposer, et
// elle n'a aucun canal vers cette application. Les deux implémentations lisent
// `test/fixtures/attachment_plan_cases.json`, où chaque plan attendu est écrit
// à la main, et doivent le rendre toutes les deux.

interface FixtureProgram {
  id: string;
  schoolId: string;
  campus_policy_note: string | null;
}

interface FixtureCase {
  name: string;
  school_id: string;
  edges: Array<{ id: string; programId: string; campusId: string }> | string;
  programs: FixtureProgram[] | string;
  ticket: unknown;
  existing: ExistingAttachment[] | string;
  expected: unknown;
}

function loadSharedCases() {
  const file = path.join(process.cwd(), "test", "fixtures", "attachment_plan_cases.json");
  const doc = JSON.parse(fs.readFileSync(file, "utf-8"));
  const corpus = doc.corpus;
  const refs: Record<string, unknown> = {
    corpus_written: corpus.written,
    corpus_note_written: corpus.programs_note_written,
  };
  const resolve = (field: string, value: unknown) =>
    value === "corpus" ? corpus[field] : typeof value === "string" && value in refs ? refs[value] : value;

  return (doc.cases as FixtureCase[]).map((c) => ({
    name: c.name,
    schoolId: resolve("school_id", c.school_id) as string,
    edges: resolve("edges", c.edges) as Array<{ id: string; programId: string; campusId: string }>,
    programs: resolve("programs", c.programs) as FixtureProgram[],
    ticket: resolve("ticket", c.ticket),
    existing: resolve("existing", c.existing) as ExistingAttachment[],
    expected: c.expected,
  }));
}

/**
 * Double générique : arêtes, lignes et programmes d'un cas. Toute méthode hors
 * des types `AttachmentTx` et `PolicyNoteTx` lève.
 */
function sharedTx(
  edges: Array<{ id: string; programId: string; campusId: string }>,
  existing: ExistingAttachment[],
  programs: FixtureProgram[]
) {
  const calls: string[] = [];
  const rows = existing.map((r) => ({ ...r, languages: [...r.languages] }));
  const byPair = new Map(edges.map((e) => [`${e.programId} ${e.campusId}`, e.id]));
  const byProgram = new Map(programs.map((p) => [p.id, { ...p }]));

  const guard = <T extends object>(name: string, allowed: string[], target: T): T =>
    new Proxy(target, {
      get(obj, prop, receiver) {
        if (typeof prop === "string" && !allowed.includes(prop)) {
          throw new Error(`${name}.${prop} appelé : hors du type déclaré`);
        }
        return Reflect.get(obj, prop, receiver);
      },
    });

  const tx = {
    programCampus: guard("programCampus", ["findUnique"], {
      findUnique(args: { where: { programId_campusId: { programId: string; campusId: string } } }) {
        const { programId, campusId } = args.where.programId_campusId;
        const id = byPair.get(`${programId} ${campusId}`);
        return Promise.resolve(id ? { id } : null);
      },
    }),
    programCampusAttachment: guard("programCampusAttachment", ["findMany", "upsert"], {
      findMany(args: { where: { programCampusId: { in: string[] } } }) {
        return Promise.resolve(
          rows.filter((r) => args.where.programCampusId.in.includes(r.programCampusId)).map((r) => ({ ...r }))
        );
      },
      upsert(args: { where: { programCampusId_study_year_regime: { programCampusId: string } } }) {
        calls.push(`attachment.upsert ${args.where.programCampusId_study_year_regime.programCampusId}`);
        return Promise.resolve({ id: "upserted" });
      },
    }),
    program: guard("program", ["findUnique", "update"], {
      findUnique(args: { where: { id: string } }) {
        const found = byProgram.get(args.where.id);
        return Promise.resolve(
          found ? { id: found.id, schoolId: found.schoolId, campus_policy_note: found.campus_policy_note } : null
        );
      },
      update(args: { where: { id: string }; data: Record<string, unknown> }) {
        calls.push(`program.update ${args.where.id} ${Object.keys(args.data).join(",")}`);
        const found = byProgram.get(args.where.id);
        if (found) found.campus_policy_note = args.data.campus_policy_note as string;
        return Promise.resolve({ id: args.where.id });
      },
    }),
  };
  return { tx: tx as unknown as AttachmentTx & PolicyNoteTx, calls, byProgram };
}

/** Le chemin complet de la route, lignes-années puis notes, sur un double. */
async function runRoutePlan(
  ticket: unknown,
  schoolId: string | null,
  rec: ReturnType<typeof sharedTx>
) {
  const folded = foldAttachmentClaims(ticket);
  const { resolved, conflicts: edgeConflicts } = await resolveAttachmentEdges(rec.tx, folded.claims);
  const existing = await readExistingAttachments(rec.tx, resolved);
  const plan = planAttachmentWrites(resolved, existing);

  const foldedNotes = foldPolicyNoteClaims(ticket);
  const { resolved: notes, conflicts: programConflicts } = await resolvePolicyNotePrograms(
    rec.tx,
    foldedNotes.claims,
    schoolId
  );
  const notePlan = planPolicyNoteWrites(notes);

  const conflicts = countBy([
    ...folded.conflicts,
    ...edgeConflicts,
    ...plan.conflicts,
    ...foldedNotes.conflicts,
    ...programConflicts,
  ]);
  return {
    plan,
    notePlan,
    summary: {
      attachments: {
        create: plan.create.length,
        update: plan.update.length,
        unchanged: plan.unchanged.length,
        stale: plan.stale.length,
      },
      policy_notes: {
        create: notePlan.create.length,
        update: notePlan.update.length,
        unchanged: notePlan.unchanged.length,
      },
      conflicts: Object.fromEntries(Object.entries(conflicts).sort(([a], [b]) => (a < b ? -1 : 1))),
      writes: plan.create.length + plan.update.length + notePlan.create.length + notePlan.update.length,
    },
  };
}

test("cas partagés avec Python : chaque plan attendu, écrit à la main, est rendu", async () => {
  const cases = loadSharedCases();
  assert.ok(cases.length >= 20);
  for (const c of cases) {
    const rec = sharedTx(c.edges, c.existing, c.programs);
    const { summary } = await runRoutePlan(c.ticket, c.schoolId, rec);
    assert.deepEqual(summary, c.expected, c.name);
  }
});

// ── Les notes de politique de campus ─────────────────────────────────────

const IBBA_NOTE =
  "Paris reste accessible chaque année, avec au moins une année obligatoire sur l’un des campus internationaux.";
const EM_NORMANDIE_ID = "school-em-normandie";

function notesTx(current: string | null, schoolId = EM_NORMANDIE_ID) {
  return sharedTx([], [], [{ id: P_IBBA, schoolId, campus_policy_note: current }]);
}

test("note de l'IBBA : un seul update, qui ne touche que campus_policy_note", async () => {
  const rec = notesTx(null);
  const ticket = {
    campus_attachments: [],
    campus_policy_notes: [{ programId: P_IBBA, program: PROGRAM_LABEL[P_IBBA], fiche: F_IBBA, note: IBBA_NOTE }],
  };
  const { notePlan } = await runRoutePlan(ticket, EM_NORMANDIE_ID, rec);
  const counts = await applyPolicyNotePlan(rec.tx, notePlan, STAMP);

  assert.deepEqual(counts, { created: 1, updated: 0, unchanged: 0 });
  // La note, et la provenance de l'écriture (plan gestion-contenu, étape 5, D11).
  assert.deepEqual(rec.calls, [`program.update ${P_IBBA} campus_policy_note,updated_by_id,updated_at,updated_via`]);
  assert.equal(rec.byProgram.get(P_IBBA)?.campus_policy_note, IBBA_NOTE);
});

test("une note ne crée aucun programme : le double lève sur program.create et program.upsert", () => {
  const rec = notesTx(null);
  const program = rec.tx.program as unknown as Record<string, unknown>;
  assert.throws(() => program.create, /hors du type déclaré/);
  assert.throws(() => program.upsert, /hors du type déclaré/);
  assert.throws(() => program.delete, /hors du type déclaré/);
});

test("une note mise à jour rend l'avant ; rejouée, elle n'émet plus aucun update", async () => {
  const rec = notesTx("Ancienne phrase.");
  const ticket = { campus_policy_notes: [{ programId: P_IBBA, program: "IBBA", fiche: F_IBBA, note: IBBA_NOTE }] };

  const first = await runRoutePlan(ticket, EM_NORMANDIE_ID, rec);
  assert.equal(first.notePlan.update[0].before, "Ancienne phrase.");
  await applyPolicyNotePlan(rec.tx, first.notePlan, STAMP);

  const second = await runRoutePlan(ticket, EM_NORMANDIE_ID, rec);
  await applyPolicyNotePlan(rec.tx, second.notePlan, STAMP);
  assert.equal(second.notePlan.unchanged.length, 1);
  assert.equal(rec.calls.filter((c) => c.startsWith("program.update")).length, 1);
});

test("ce chemin n'efface jamais une note : une fiche sans note ne touche à rien", async () => {
  const rec = notesTx(IBBA_NOTE);
  const { notePlan, summary } = await runRoutePlan({ campus_attachments: [] }, EM_NORMANDIE_ID, rec);
  await applyPolicyNotePlan(rec.tx, notePlan, STAMP);

  assert.equal(summary.writes, 0);
  assert.deepEqual(rec.calls, []);
  assert.equal(rec.byProgram.get(P_IBBA)?.campus_policy_note, IBBA_NOTE);
});

test("un programme d'une autre école ne reçoit pas la note, même avec son vrai identifiant", async () => {
  const rec = notesTx(null, "une-autre-ecole");
  const ticket = { campus_policy_notes: [{ programId: P_IBBA, program: "IBBA", fiche: F_IBBA, note: IBBA_NOTE }] };
  const { summary } = await runRoutePlan(ticket, EM_NORMANDIE_ID, rec);

  assert.equal(summary.writes, 0);
  assert.deepEqual(summary.conflicts, { program_outside_school: 1 });
});

// ── Le bloc qui oriente un ticket ────────────────────────────────────────

test("hasCampusAttachmentBlock reconnaît la charge de la collecte, et elle seule", () => {
  assert.equal(hasCampusAttachmentBlock({ campus_attachments: [] }), true);
  assert.equal(hasCampusAttachmentBlock({ campus_attachments: CORPUS, campus_policy_notes: [] }), true);
  assert.equal(hasCampusAttachmentBlock({ discovered_campuses: [] }), false);
  assert.equal(hasCampusAttachmentBlock({ campus_attachments: "non" }), false);
  assert.equal(hasCampusAttachmentBlock(null), false);
  assert.equal(hasCampusAttachmentBlock([{ campus_attachments: [] }]), false);
});
