/**
 * app/api/admin/inbox/[id]/validate/route.ts — PUT /api/admin/inbox/[id]/validate (Étape 3.1-3.3)
 *
 * Valide un ticket ContributionInbox et transfère les données vers les tables de production.
 *
 * RÈGLES ABSOLUES (Règle 2 + Règle 5) :
 * - Toujours utiliser upsert() pour éviter les doublons (contraintes @@unique)
 * - Transaction atomique pour Program_Discovery (rollback si erreur)
 * - Aucune donnée ne rejoint la production sans validation humaine
 *
 * Catégories gérées :
 * - Program_Discovery : Campus[] + Program[] → transaction atomique
 * - Pricing          : PricingRecord upsert [programId, academic_year]
 * - Ranking          : RankingRecord upsert [programId, academic_year, ranking_name]
 * - Capacity         : CapacityRecord upsert [programId, academic_year]
 * - SchoolStats      : SchoolStatsRecord upsert [schoolId, academic_year]
 * - Accreditation    : AccreditationRecord upsert [schoolId, accreditation_name]
 *
 * Référence : task.md §3.2-3.3, bdd.md §4 (upserting), architecture.md §5.2
 */

import { guardAdmin } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { STATUS_REJECTED, STATUS_VALIDATED, isParkedResearchReport } from "@/lib/contribution";
import { hasCampusAttachmentBlock } from "@/lib/campus-attachment";
import { adminCorrections, readOptionalJsonObject } from "@/lib/request-body";

// ──────────────────────────────────────────────
// Types internes pour les données JSON des tickets
// ──────────────────────────────────────────────

interface DiscoveredProgram {
  name: string;
  admission_exam?: string | null;
  is_alternance_possible?: boolean | null;
  is_expatriation_mandatory?: boolean | null;
  min_expatriation_months?: number | null;
  max_internship_months?: number | null;
}

interface DiscoveredCampus {
  name: string;
  city?: string | null;
  programs: DiscoveredProgram[];
}

interface ProgramDiscoveryJson {
  discovered_campuses: DiscoveredCampus[];
}

interface PricingJson {
  academic_year: number;
  currency?: string;
  year_1_fee?: number | null;
  year_2_fee?: number | null;
  year_3_fee?: number | null;
  year_4_fee?: number | null;
  year_5_fee?: number | null;
  total_fee?: number | null;
  intl_year_1_fee?: number | null;
  intl_total_fee?: number | null;
  intl_currency?: string | null;
  additional_fees_notes?: string | null;
  source_url?: string | null;
  year_assumed?: boolean;
  data_conflict_warning?: boolean;
}

// Format liste (nouveau) — le pipeline émet un ticket par classement, mais un
// ticket peut aussi porter le tableau complet. Les deux se valident.
interface RankingItem {
  ranking_name: string;
  rank: number;
  academic_year: number;
  // Libellé d'origine du palmarès, conservé quand ranking_name vaut « Autre ».
  ranking_label?: string | null;
  scope?: "program" | "school";
  program_hint?: string | null;
  total_ranked?: number | null;
  source_url?: string | null;
  data_conflict_warning?: boolean;
}

interface RankingJson {
  // Nouveau format : tableau de classements
  rankings?: RankingItem[];
  // Ancien format single-object (rétrocompatibilité)
  ranking_name?: string;
  rank?: number;
  academic_year?: number;
  source_url?: string | null;
  data_conflict_warning?: boolean;
}

// Une entrée par voie d'admission : SESAME, ACCÈS, Parcoursup, admissions
// parallèles. CapacityRecord n'a qu'une ligne par (programCampus, année) — la
// recomposition se fait ici, à la validation, sous l'œil de l'admin.
interface CapacityItem {
  spots_available: number;
  academic_year: number;
  admission_channel?: string | null;
  source_url?: string | null;
  year_assumed?: boolean;
}

interface CapacityJson {
  // Nouveau format : tableau de voies d'admission
  capacities?: CapacityItem[];
  // Ancien format single-object (rétrocompatibilité)
  spots_available?: number;
  academic_year?: number;
  source_url?: string | null;
  year_assumed?: boolean;
}

interface SchoolStatsJson {
  academic_year: number;
  total_students?: number | null;
  total_alumni?: number | null;
  partner_companies?: number | null;
  annual_internship_offers?: number | null;
  abroad_campuses?: number | null;
  partner_universities?: number | null;
  permanent_professors?: number | null;
  international_professors_pct?: number | null;
  external_speakers_pct?: number | null;
  source_url?: string | null;
}

// Format liste (nouveau) — un ticket contient toutes les accréditations de l'école
interface AccreditationItem {
  accreditation_name: string;
  accreditation_type?: "international" | "label" | "state";
  year_obtained?: number | null;
  is_active?: boolean;
  source_url?: string | null;
}

interface AccreditationJson {
  // Nouveau format : tableau de toutes les accréditations
  accreditations?: AccreditationItem[];
  // Ancien format single-object (rétrocompatibilité)
  accreditation_name?: string;
  accreditation_type?: "international" | "label" | "state";
  year_obtained?: number | null;
  is_active?: boolean;
}

// Format multi-programme (nouveau — crowdsourcing avec matching IA)
interface MatchedProgramEntry {
  extracted_program_name: string;
  matched_program_id: string | null;
  matched_program_name: string | null;
  match_confidence: "exact" | "fuzzy" | "none";
  data: Record<string, unknown>;
}

interface MultiProgramJson {
  programs: MatchedProgramEntry[];
  unmatched_programs?: Array<{ extracted_program_name: string; reason: string }>;
  source_url?: string;
  year_assumed?: boolean;
  data_conflict_warning?: boolean;
}

function isMultiProgramJson(json: unknown): json is MultiProgramJson {
  return (
    typeof json === "object" &&
    json !== null &&
    "programs" in json &&
    Array.isArray((json as MultiProgramJson).programs)
  );
}

// ──────────────────────────────────────────────
// Handler principal
// ──────────────────────────────────────────────

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardAdmin();
  if (error) return error;

  const { id } = await params;

  // Le body peut contenir des données modifiées par l'Admin (formulaire
  // répéteur). Lu avant la base : un corps illisible est refusé, jamais
  // remplacé en silence par ai_extracted_json (F2, lib/request-body.ts).
  const body = await readOptionalJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }

  try {
    const ticket = await prisma.contributionInbox.findUnique({ where: { id } });

    if (!ticket) {
      return NextResponse.json({ error: "Ticket introuvable" }, { status: 404 });
    }

    if (ticket.status === STATUS_VALIDATED) {
      return NextResponse.json({ error: "Ticket déjà validé" }, { status: 400 });
    }

    if (ticket.status === STATUS_REJECTED) {
      return NextResponse.json(
        { error: "Impossible de valider un ticket rejeté" },
        { status: 400 }
      );
    }

    // Un rapport Research rangé n'a rien à valider : son extraction a échoué,
    // le formulaire enverrait `discovered_campuses: []`, et le ticket clôturé
    // ne serait plus repris par la Phase 1 — qui repaierait Research. Le rejeter
    // reste possible, et c'est la façon de dire « ne le reprenez pas ».
    if (isParkedResearchReport(ticket.ai_extracted_json)) {
      return NextResponse.json(
        {
          error:
            "Ce ticket conserve un rapport Research dont l'extraction a échoué. " +
            "La prochaine Phase 1 de l'école le reprendra sans repayer Research ; " +
            "rejetez-le pour qu'il ne soit pas repris.",
        },
        { status: 400 }
      );
    }

    // Un ticket de rattachement campus ne se valide pas ici. Le formulaire
    // répéteur n'en voit rien et enverrait `discovered_campuses: []`, que
    // `validateProgramDiscovery` accepte : le ticket serait clôturé sans une
    // ligne écrite, et la route voisine le refuserait ensuite comme déjà
    // validé. On lit la charge ENREGISTRÉE, pas le corps : c'est elle que le
    // corps du formulaire masque.
    if (ticket.ai_category === "Program_Discovery" && hasCampusAttachmentBlock(ticket.ai_extracted_json)) {
      return NextResponse.json(
        {
          error:
            "Ce ticket porte un bloc campus_attachments : il s'écrit par PUT /api/admin/inbox/[id]/attachments. " +
            "La validation Program_Discovery le clôturerait sans rien écrire.",
        },
        { status: 400 }
      );
    }

    // Le corps de l'admin prime sur ai_extracted_json ; absent ou `{}`, le
    // ticket est validé tel quel.
    const rawJson = adminCorrections(body.body) ?? ticket.ai_extracted_json;

    if (!rawJson) {
      return NextResponse.json(
        { error: "Aucune donnée JSON à valider dans ce ticket" },
        { status: 400 }
      );
    }

    const category = ticket.ai_category;

    // ── Dispatch par catégorie ──────────────────
    if (["Pricing", "Ranking", "Capacity"].includes(category) && isMultiProgramJson(rawJson)) {
      return await validateMultiProgram(ticket, category, rawJson as MultiProgramJson);
    }
    switch (category) {
      case "Program_Discovery":
        return await validateProgramDiscovery(ticket, rawJson as unknown as ProgramDiscoveryJson);

      case "Pricing":
        return await validatePricing(ticket, rawJson as unknown as PricingJson);

      case "Ranking":
        return await validateRanking(ticket, rawJson as unknown as RankingJson);

      case "Capacity":
        return await validateCapacity(ticket, rawJson as unknown as CapacityJson);

      case "SchoolStats":
        return await validateSchoolStats(ticket, rawJson as unknown as SchoolStatsJson);

      case "Accreditation":
        return await validateAccreditation(ticket, rawJson as unknown as AccreditationJson);

      default:
        return NextResponse.json(
          { error: `Catégorie inconnue: ${category}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error(`PUT /api/admin/inbox/${id}/validate error:`, error);
    return NextResponse.json({ error: "Erreur serveur interne" }, { status: 500 });
  }
}

// ──────────────────────────────────────────────
// Program_Discovery — Transaction atomique Campus + Programs (niveau école)
// Référence : task.md §3.2, architecture.md §5.2
//
// Nouvelle logique :
// 1. Upsert Campus (inchangé)
// 2. Pour chaque programme de chaque campus :
//    - Upsert Program avec schoolId (déduplication automatique par @@unique([schoolId, name]))
//    - Upsert ProgramCampus pour créer l'association programme ↔ campus
// 3. Un même programme sur N campus = 1 Program + N ProgramCampus
// ──────────────────────────────────────────────

async function validateProgramDiscovery(
  ticket: { id: string; schoolId: string | null },
  data: ProgramDiscoveryJson
) {
  if (!ticket.schoolId) {
    return NextResponse.json(
      { error: "schoolId manquant dans le ticket Program_Discovery" },
      { status: 400 }
    );
  }

  if (!data.discovered_campuses || !Array.isArray(data.discovered_campuses)) {
    return NextResponse.json(
      { error: "discovered_campuses manquant ou invalide dans le JSON" },
      { status: 400 }
    );
  }

  // Transaction atomique : tout réussit ou tout rollback (bdd.md §4)
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Upserts sérialisés, et non groupés dans un Promise.all.
      //
      // `tx` est un client transactionnel : il ne dispose que d'UNE connexion.
      // Lancer les upserts en parallèle dessus n'apporte aucun parallélisme
      // réel — ils se remettent en file sur la même connexion — et, sous
      // charge, mène au blocage ou au dépassement du délai de 60 s.
      //
      // Un même programme sur N campus = 1 Program + N ProgramCampus.
      const stats: Array<{ campusId: string; campusName: string; programsLinked: number }> = [];

      for (const campusData of data.discovered_campuses) {
        if (!campusData.name) continue;

        const campus = await tx.campus.upsert({
          where: {
            schoolId_name: {
              schoolId: ticket.schoolId!,
              name: campusData.name,
            },
          },
          create: {
            schoolId: ticket.schoolId!,
            name: campusData.name,
            city: campusData.city ?? null,
          },
          update: {
            city: campusData.city ?? undefined,
          },
        });

        let programsLinked = 0;

        if (Array.isArray(campusData.programs)) {
          for (const prog of campusData.programs) {
            if (!prog.name) continue;
            programsLinked++;

            // Upsert du programme au niveau école
            // @@unique([schoolId, name]) garantit la déduplication
            const program = await tx.program.upsert({
              where: {
                schoolId_name: {
                  schoolId: ticket.schoolId!,
                  name: prog.name,
                },
              },
              create: {
                schoolId: ticket.schoolId!,
                name: prog.name,
                admission_exam: prog.admission_exam ?? null,
                is_alternance_possible: prog.is_alternance_possible ?? false,
                is_expatriation_mandatory: prog.is_expatriation_mandatory ?? false,
                min_expatriation_months: prog.min_expatriation_months ?? null,
                max_internship_months: prog.max_internship_months ?? null,
              },
              update: {
                admission_exam: prog.admission_exam ?? undefined,
                is_alternance_possible: prog.is_alternance_possible ?? undefined,
                is_expatriation_mandatory: prog.is_expatriation_mandatory ?? undefined,
              },
            });

            // Upsert ProgramCampus : associe ce programme à ce campus
            await tx.programCampus.upsert({
              where: {
                programId_campusId: {
                  programId: program.id,
                  campusId: campus.id,
                },
              },
              create: {
                programId: program.id,
                campusId: campus.id,
              },
              update: {}, // L'association existe déjà, rien à mettre à jour
            });
          }
        }

        stats.push({
          campusId: campus.id,
          campusName: campus.name,
          programsLinked,
        });
      }

      // Marquer le ticket comme validé
      await tx.contributionInbox.update({
        where: { id: ticket.id },
        data: { status: STATUS_VALIDATED },
      });

      return stats;
    }, {
      timeout: 60000, // 60s timeout pour les imports volumineux
    });

    return NextResponse.json({
      message: "Program_Discovery validé avec succès",
      campuses_processed: result,
    });
  } catch (error) {
    console.error("Transaction Program_Discovery échouée:", error);
    return NextResponse.json(
      { error: "Erreur lors de la transaction. Rollback effectué. Aucune donnée insérée." },
      { status: 500 }
    );
  }
}

// ──────────────────────────────────────────────
// Pricing — Upsert PricingRecord [programId, academic_year]
// Référence : task.md §3.3, bdd.md §2 (PricingRecord)
// ──────────────────────────────────────────────

async function validatePricing(
  ticket: { id: string; programId: string | null; year_assumed: boolean; data_conflict_warning: boolean },
  data: PricingJson
) {
  if (!ticket.programId) {
    return NextResponse.json({ error: "programId manquant pour un ticket Pricing" }, { status: 400 });
  }
  if (!data.academic_year) {
    return NextResponse.json({ error: "academic_year manquant dans le JSON Pricing" }, { status: 400 });
  }

  // Upsert et clôture du ticket dans UNE SEULE transaction. Séparés, un échec
  // du second appel laissait la donnée écrite et le ticket ouvert : l'admin
  // revalidait et écrasait.
  const [record] = await prisma.$transaction([
    prisma.pricingRecord.upsert({
      where: {
        programId_academic_year: {
          programId: ticket.programId,
          academic_year: data.academic_year,
        },
      },
      create: {
        programId: ticket.programId,
        academic_year: data.academic_year,
        currency: data.currency ?? "EUR",
        year_1_fee: data.year_1_fee ?? null,
        year_2_fee: data.year_2_fee ?? null,
        year_3_fee: data.year_3_fee ?? null,
        year_4_fee: data.year_4_fee ?? null,
        year_5_fee: data.year_5_fee ?? null,
        total_fee: data.total_fee ?? null,
        intl_year_1_fee: data.intl_year_1_fee ?? null,
        intl_total_fee: data.intl_total_fee ?? null,
        intl_currency: data.intl_currency ?? null,
        additional_fees_notes: data.additional_fees_notes ?? null,
        source_url: data.source_url ?? null,
      },
      update: {
        currency: data.currency ?? "EUR",
        year_1_fee: data.year_1_fee ?? null,
        year_2_fee: data.year_2_fee ?? null,
        year_3_fee: data.year_3_fee ?? null,
        year_4_fee: data.year_4_fee ?? null,
        year_5_fee: data.year_5_fee ?? null,
        total_fee: data.total_fee ?? null,
        intl_year_1_fee: data.intl_year_1_fee ?? null,
        intl_total_fee: data.intl_total_fee ?? null,
        intl_currency: data.intl_currency ?? null,
        additional_fees_notes: data.additional_fees_notes ?? null,
        source_url: data.source_url ?? null,
      },
    }),
    prisma.contributionInbox.update({
      where: { id: ticket.id },
      data: { status: STATUS_VALIDATED },
    }),
  ]);

  return NextResponse.json({ message: "PricingRecord créé/mis à jour", record });
}

// ──────────────────────────────────────────────
// Ranking — Upsert RankingRecord [programId, academic_year, ranking_name]
// ⚠️ Le ticket peut contenir une LISTE de classements (nouveau format) ou un
//    objet unique (ancien format — rétrocompatibilité). Même logique que
//    validateAccreditation, qui gère les deux depuis plus longtemps.
//
// La base est unique sur (programId, academic_year, ranking_name) : elle sait
// stocker N classements par programme et par an. C'est le schéma envoyé à
// Tavily qui n'en laissait passer qu'un — le modèle de données et le schéma
// d'extraction ne se parlaient pas.
// ──────────────────────────────────────────────

async function validateRanking(
  ticket: { id: string; programId: string | null },
  data: RankingJson
) {
  const programId = ticket.programId;
  if (!programId) {
    return NextResponse.json({ error: "programId manquant pour un ticket Ranking" }, { status: 400 });
  }

  // Normaliser : construire une liste unifiée depuis les deux formats possibles
  let rankingItems: RankingItem[];

  if (Array.isArray(data.rankings) && data.rankings.length > 0) {
    rankingItems = data.rankings;
  } else if (data.ranking_name != null) {
    rankingItems = [
      {
        ranking_name: data.ranking_name,
        rank: data.rank as number,
        academic_year: data.academic_year as number,
        source_url: data.source_url ?? null,
        data_conflict_warning: data.data_conflict_warning,
      },
    ];
  } else {
    return NextResponse.json(
      { error: "rankings[] ou ranking_name est requis" },
      { status: 400 }
    );
  }

  // Un rang commence à 1 : contrairement à spots_available, 0 n'est pas une
  // valeur signifiante ici, et une entrée incomplète ne doit pas passer.
  const invalid = rankingItems.find(
    (item) => !item.ranking_name || !item.rank || !item.academic_year
  );
  if (invalid) {
    return NextResponse.json(
      { error: "ranking_name, rank et academic_year sont requis pour chaque classement" },
      { status: 400 }
    );
  }

  // Dédoublonner sur la clé d'unicité : deux entrées identiques dans le même
  // tableau feraient échouer la transaction Prisma sur une contrainte violée.
  const byKey = new Map<string, RankingItem>();
  for (const item of rankingItems) {
    byKey.set(`${item.academic_year}::${item.ranking_name}`, item);
  }
  const uniqueItems = [...byKey.values()];

  // Upserts et clôture du ticket dans UNE SEULE transaction. Séparés, un échec
  // du second appel laissait la donnée écrite et le ticket ouvert : l'admin
  // revalidait et écrasait.
  const results = await prisma.$transaction([
    ...uniqueItems.map((item) =>
      prisma.rankingRecord.upsert({
        where: {
          programId_academic_year_ranking_name: {
            programId,
            academic_year: item.academic_year,
            ranking_name: item.ranking_name,
          },
        },
        create: {
          programId,
          academic_year: item.academic_year,
          ranking_name: item.ranking_name,
          rank: item.rank,
          source_url: item.source_url ?? null,
        },
        update: {
          rank: item.rank,
          source_url: item.source_url ?? null,
        },
      })
    ),
    prisma.contributionInbox.update({
      where: { id: ticket.id },
      data: { status: STATUS_VALIDATED },
    }),
  ]);

  // Le dernier élément est la mise à jour du ticket, pas un enregistrement.
  const records = results.slice(0, uniqueItems.length);

  return NextResponse.json({
    message: `${records.length} RankingRecord(s) créé(s)/mis à jour`,
    count: records.length,
    records,
    // Compatibilité de forme avec l'ancienne réponse à un seul enregistrement.
    record: records[0],
  });
}

// ──────────────────────────────────────────────
// Capacity — Upsert CapacityRecord [programCampusId, academic_year]
// La capacity varie par campus. On utilise programCampusId.
// Si le ticket a programCampusId directement (pipeline auto), on l'utilise.
// Sinon on le résout depuis (programId, campusId) (crowdsourcing).
// ──────────────────────────────────────────────

// Libellés désignant un total déjà agrégé par la source. Une entrée « toutes
// voies » vaut pour l'année entière : l'additionner aux voies détaillées
// compterait deux fois les mêmes places.
const TOTAL_CHANNEL_RE = /^(toutes?\s+(les\s+)?voies(\s+confondues)?|total(\s+g[ée]n[ée]ral)?|all\s+channels?)$/i;

/**
 * Recompose une capacité par année à partir des voies d'admission extraites.
 *
 * Le pipeline extrait une entrée par concours (SESAME, ACCÈS, Parcoursup…)
 * parce que c'est ainsi que les places sont publiées, et il n'additionne
 * jamais lui-même : CapacityRecord n'a qu'une ligne par (programCampus, année),
 * et la somme est un arbitrage, pas une donnée.
 *
 * Règle, volontairement simple pour rester explicable à l'admin :
 *   - une seule entrée pour l'année → on la prend ;
 *   - un total explicite parmi plusieurs entrées → on prend ce total seul ;
 *   - sinon → somme des voies.
 * L'admin garde le dernier mot : le corps de la requête est prioritaire sur
 * ai_extracted_json, il peut donc envoyer le chiffre qu'il a arbitré.
 */
function foldCapacities(items: CapacityItem[]): Array<{
  academic_year: number;
  spots_available: number;
  source_url: string | null;
  method: "single" | "declared_total" | "sum";
  channels: number;
}> {
  const byYear = new Map<number, CapacityItem[]>();
  for (const item of items) {
    const list = byYear.get(item.academic_year) ?? [];
    list.push(item);
    byYear.set(item.academic_year, list);
  }

  return [...byYear.entries()].map(([academic_year, entries]) => {
    const sourceUrl = entries.find((e) => e.source_url)?.source_url ?? null;

    if (entries.length === 1) {
      return {
        academic_year,
        spots_available: entries[0].spots_available,
        source_url: sourceUrl,
        method: "single" as const,
        channels: 1,
      };
    }

    const declaredTotals = entries.filter((e) =>
      TOTAL_CHANNEL_RE.test((e.admission_channel ?? "").trim())
    );
    if (declaredTotals.length === 1) {
      return {
        academic_year,
        spots_available: declaredTotals[0].spots_available,
        source_url: declaredTotals[0].source_url ?? sourceUrl,
        method: "declared_total" as const,
        channels: entries.length,
      };
    }

    return {
      academic_year,
      spots_available: entries.reduce((sum, e) => sum + e.spots_available, 0),
      source_url: sourceUrl,
      method: "sum" as const,
      channels: entries.length,
    };
  });
}

async function validateCapacity(
  ticket: { id: string; programId: string | null; programCampusId: string | null; campusId: string | null },
  data: CapacityJson
) {
  // Normaliser : construire une liste unifiée depuis les deux formats possibles.
  //
  // L'ordre des branches compte. Le chiffre explicite passe AVANT le tableau,
  // et il couvre deux cas d'un coup : un ticket d'ancien format, et un ticket
  // de nouveau format dont l'admin a saisi le total lui-même dans le
  // formulaire. Le corps de la requête écrase ai_extracted_json ; si le tableau
  // primait, l'arbitrage humain serait recalculé puis jeté en silence — l'exact
  // contraire de ce que la boucle de validation existe pour garantir.
  // == null et non !valeur : 0 place (formation fermée) est une donnée valide.
  let capacityItems: CapacityItem[];

  if (data.spots_available != null && data.academic_year) {
    capacityItems = [
      {
        spots_available: data.spots_available,
        academic_year: data.academic_year,
        source_url: data.source_url ?? null,
        year_assumed: data.year_assumed,
      },
    ];
  } else if (Array.isArray(data.capacities) && data.capacities.length > 0) {
    capacityItems = data.capacities.filter(
      (item) => item && item.spots_available != null && !!item.academic_year
    );
    if (capacityItems.length === 0) {
      return NextResponse.json(
        { error: "Aucune capacité valide dans le ticket (spots_available et academic_year requis)" },
        { status: 400 }
      );
    }
  } else {
    return NextResponse.json({ error: "spots_available et academic_year sont requis" }, { status: 400 });
  }

  const folded = foldCapacities(capacityItems);

  // Résoudre programCampusId
  let programCampusId = ticket.programCampusId;

  if (!programCampusId) {
    // Fallback : résoudre depuis (programId, campusId)
    if (!ticket.programId || !ticket.campusId) {
      return NextResponse.json(
        { error: "programCampusId (ou programId + campusId) manquant pour un ticket Capacity" },
        { status: 400 }
      );
    }
    const pc = await prisma.programCampus.findUnique({
      where: {
        programId_campusId: {
          programId: ticket.programId,
          campusId: ticket.campusId,
        },
      },
    });
    if (!pc) {
      return NextResponse.json(
        { error: `ProgramCampus introuvable pour programId=${ticket.programId} campusId=${ticket.campusId}` },
        { status: 400 }
      );
    }
    programCampusId = pc.id;
  }

  // Upserts et clôture du ticket dans UNE SEULE transaction. Séparés, un échec
  // du second appel laissait la donnée écrite et le ticket ouvert : l'admin
  // revalidait et écrasait.
  const resolvedProgramCampusId = programCampusId;
  const results = await prisma.$transaction([
    ...folded.map((entry) =>
      prisma.capacityRecord.upsert({
        where: {
          programCampusId_academic_year: {
            programCampusId: resolvedProgramCampusId,
            academic_year: entry.academic_year,
          },
        },
        create: {
          programCampusId: resolvedProgramCampusId,
          academic_year: entry.academic_year,
          spots_available: entry.spots_available,
          source_url: entry.source_url,
        },
        update: {
          spots_available: entry.spots_available,
          source_url: entry.source_url,
        },
      })
    ),
    prisma.contributionInbox.update({
      where: { id: ticket.id },
      data: { status: STATUS_VALIDATED },
    }),
  ]);

  // Le dernier élément est la mise à jour du ticket, pas un enregistrement.
  const records = results.slice(0, folded.length);

  return NextResponse.json({
    message: `${records.length} CapacityRecord(s) créé(s)/mis à jour`,
    count: records.length,
    records,
    // Comment chaque année a été recomposée : l'admin doit pouvoir voir qu'un
    // chiffre est une somme de voies et non un total publié.
    breakdown: folded.map((entry) => ({
      academic_year: entry.academic_year,
      spots_available: entry.spots_available,
      method: entry.method,
      channels: entry.channels,
    })),
    // Compatibilité de forme avec l'ancienne réponse à un seul enregistrement.
    record: records[0],
  });
}

// ──────────────────────────────────────────────
// SchoolStats — Upsert SchoolStatsRecord [schoolId, academic_year]
// ──────────────────────────────────────────────

async function validateSchoolStats(
  ticket: { id: string; schoolId: string | null },
  data: SchoolStatsJson
) {
  if (!ticket.schoolId) {
    return NextResponse.json({ error: "schoolId manquant pour un ticket SchoolStats" }, { status: 400 });
  }
  if (!data.academic_year) {
    return NextResponse.json({ error: "academic_year est requis" }, { status: 400 });
  }

  // Upsert et clôture du ticket dans UNE SEULE transaction. Séparés, un échec
  // du second appel laissait la donnée écrite et le ticket ouvert : l'admin
  // revalidait et écrasait.
  const [record] = await prisma.$transaction([
    prisma.schoolStatsRecord.upsert({
      where: {
        schoolId_academic_year: {
          schoolId: ticket.schoolId,
          academic_year: data.academic_year,
        },
      },
      create: {
        schoolId: ticket.schoolId,
        academic_year: data.academic_year,
        total_students: data.total_students ?? null,
        total_alumni: data.total_alumni ?? null,
        partner_companies: data.partner_companies ?? null,
        annual_internship_offers: data.annual_internship_offers ?? null,
        abroad_campuses: data.abroad_campuses ?? null,
        partner_universities: data.partner_universities ?? null,
        permanent_professors: data.permanent_professors ?? null,
        international_professors_pct: data.international_professors_pct ?? null,
        external_speakers_pct: data.external_speakers_pct ?? null,
      },
      update: {
        total_students: data.total_students ?? null,
        total_alumni: data.total_alumni ?? null,
        partner_companies: data.partner_companies ?? null,
        annual_internship_offers: data.annual_internship_offers ?? null,
        abroad_campuses: data.abroad_campuses ?? null,
        partner_universities: data.partner_universities ?? null,
        permanent_professors: data.permanent_professors ?? null,
        international_professors_pct: data.international_professors_pct ?? null,
        external_speakers_pct: data.external_speakers_pct ?? null,
      },
    }),
    prisma.contributionInbox.update({
      where: { id: ticket.id },
      data: { status: STATUS_VALIDATED },
    }),
  ]);

  return NextResponse.json({ message: "SchoolStatsRecord créé/mis à jour", record });
}

// ──────────────────────────────────────────────
// Accreditation — Upsert AccreditationRecord [schoolId, accreditation_name]
// ⚠️ Le ticket peut contenir une LISTE d'accréditations (nouveau format) ou
//    un objet unique (ancien format — rétrocompatibilité).
// ──────────────────────────────────────────────

async function validateAccreditation(
  ticket: { id: string; schoolId: string | null },
  data: AccreditationJson
) {
  if (!ticket.schoolId) {
    return NextResponse.json({ error: "schoolId manquant pour un ticket Accreditation" }, { status: 400 });
  }

  // Normaliser : construire une liste unifiée depuis les deux formats possibles
  //
  // La classification se faisait par sous-chaîne : `n.includes("cti")` rangeait
  // « Label Sélection Nationale » dans les labels d'État, parce que « sélection »
  // contient c-t-i. On compare désormais sur des mots entiers, après découpage
  // et retrait des accents.
  //
  // Ce repli ne devrait servir que pour les tickets anciens : le prompt
  // Accreditation demande désormais accreditation_type explicitement, des deux
  // côtés du pipeline.
  const INTERNATIONAL_NAMES = new Set(["equis", "aacsb", "amba", "epas", "bsis", "abet", "fibaa"]);
  const STATE_NAMES = new Set(["cti", "cefdg", "hceres"]);

  const toWords = (name: string): string[] =>
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter(Boolean);

  const inferType = (name: string): "international" | "label" | "state" => {
    const words = toWords(name);
    if (words.some((w) => INTERNATIONAL_NAMES.has(w))) return "international";
    if (words.some((w) => STATE_NAMES.has(w))) return "state";
    // « Grade de Master », « Grade de Licence », « grade master »…
    if (words.includes("grade") && (words.includes("master") || words.includes("licence"))) {
      return "state";
    }
    return "label";
  };

  let accreditationItems: Array<{
    accreditation_name: string;
    accreditation_type: "international" | "label" | "state";
    // null et non 0 : l'année 0 entrait en production comme une donnée réelle.
    year_obtained: number | null;
    is_active: boolean;
  }>;

  if (data.accreditations && Array.isArray(data.accreditations) && data.accreditations.length > 0) {
    // Nouveau format : liste
    accreditationItems = data.accreditations
      .filter((item) => item.accreditation_name)
      .map((item) => ({
        accreditation_name: item.accreditation_name,
        accreditation_type: item.accreditation_type ?? inferType(item.accreditation_name),
        year_obtained: item.year_obtained ?? null,
        is_active: item.is_active ?? true,
      }));
  } else if (data.accreditation_name) {
    // Ancien format : objet unique (rétrocompatibilité)
    accreditationItems = [{
      accreditation_name: data.accreditation_name,
      accreditation_type: data.accreditation_type ?? inferType(data.accreditation_name),
      year_obtained: data.year_obtained ?? null,
      is_active: data.is_active ?? true,
    }];
  } else {
    return NextResponse.json(
      { error: "accreditations[] ou accreditation_name est requis" },
      { status: 400 }
    );
  }

  if (accreditationItems.length === 0) {
    return NextResponse.json({ error: "Aucune accréditation valide dans le ticket" }, { status: 400 });
  }

  // Upsert de toutes les accréditations ET clôture du ticket dans la même
  // transaction : la mise à jour du statut était jusqu'ici hors transaction.
  const results = await prisma.$transaction([
    ...accreditationItems.map((item) =>
      prisma.accreditationRecord.upsert({
        where: {
          schoolId_accreditation_name: {
            schoolId: ticket.schoolId!,
            accreditation_name: item.accreditation_name,
          },
        },
        create: {
          schoolId: ticket.schoolId!,
          accreditation_name: item.accreditation_name,
          accreditation_type: item.accreditation_type,
          year_obtained: item.year_obtained,
          is_active: item.is_active,
        },
        update: {
          accreditation_type: item.accreditation_type,
          year_obtained: item.year_obtained,
          is_active: item.is_active,
        },
      })
    ),
    prisma.contributionInbox.update({
      where: { id: ticket.id },
      data: { status: STATUS_VALIDATED },
    }),
  ]);

  // Le dernier élément est la mise à jour du ticket, pas un enregistrement.
  const records = results.slice(0, accreditationItems.length);

  return NextResponse.json({
    message: `${records.length} AccreditationRecord(s) créé(s)/mis à jour`,
    count: records.length,
    records,
  });
}

// ──────────────────────────────────────────────
// Multi-Programme — Validation N résultats en une transaction
// Supporte Pricing, Ranking, Capacity avec matching IA
// ──────────────────────────────────────────────

async function validateMultiProgram(
  ticket: { id: string; schoolId: string | null },
  category: string,
  data: MultiProgramJson
) {
  if (!data.programs || data.programs.length === 0) {
    return NextResponse.json(
      { error: "Aucun programme matché dans ce ticket" },
      { status: 400 }
    );
  }

  // Filtrer les programmes qui ont un matched_program_id
  const validPrograms = data.programs.filter((p) => p.matched_program_id);

  if (validPrograms.length === 0) {
    return NextResponse.json(
      { error: "Aucun programme n'a pu être rattaché à un ID existant en base" },
      { status: 400 }
    );
  }

  // Entrées écartées : renvoyées à l'admin au lieu d'être avalées par un
  // `continue` silencieux. Déclaré hors transaction pour survivre au callback.
  const skipped: Array<{ program: string; reason: string }> = [];

  try {
    const results = await prisma.$transaction(async (tx) => {
      const records: unknown[] = [];

      for (const prog of validPrograms) {
        const programId = prog.matched_program_id!;
        const label =
          prog.matched_program_name ?? prog.extracted_program_name ?? programId;
        const d = prog.data;

        if (category === "Pricing") {
          const academicYear = d.academic_year as number;
          if (!academicYear) {
            skipped.push({ program: label, reason: "academic_year absent" });
            continue;
          }

          const record = await tx.pricingRecord.upsert({
            where: {
              programId_academic_year: {
                programId,
                academic_year: academicYear,
              },
            },
            create: {
              programId,
              academic_year: academicYear,
              currency: (d.currency as string) ?? "EUR",
              year_1_fee: (d.year_1_fee as number) ?? null,
              year_2_fee: (d.year_2_fee as number) ?? null,
              year_3_fee: (d.year_3_fee as number) ?? null,
              year_4_fee: (d.year_4_fee as number) ?? null,
              year_5_fee: (d.year_5_fee as number) ?? null,
              total_fee: (d.total_fee as number) ?? null,
              intl_year_1_fee: (d.intl_year_1_fee as number) ?? null,
              intl_total_fee: (d.intl_total_fee as number) ?? null,
              intl_currency: (d.intl_currency as string) ?? null,
              additional_fees_notes: (d.additional_fees_notes as string) ?? null,
              source_url: (d.source_url as string) ?? null,
            },
            update: {
              currency: (d.currency as string) ?? "EUR",
              year_1_fee: (d.year_1_fee as number) ?? null,
              year_2_fee: (d.year_2_fee as number) ?? null,
              year_3_fee: (d.year_3_fee as number) ?? null,
              year_4_fee: (d.year_4_fee as number) ?? null,
              year_5_fee: (d.year_5_fee as number) ?? null,
              total_fee: (d.total_fee as number) ?? null,
              intl_year_1_fee: (d.intl_year_1_fee as number) ?? null,
              intl_total_fee: (d.intl_total_fee as number) ?? null,
              intl_currency: (d.intl_currency as string) ?? null,
              additional_fees_notes: (d.additional_fees_notes as string) ?? null,
              source_url: (d.source_url as string) ?? null,
            },
          });
          records.push(record);

        } else if (category === "Ranking") {
          const rankingName = d.ranking_name as string;
          const rank = d.rank as number;
          const academicYear = d.academic_year as number;
          if (!rankingName || !rank || !academicYear) {
            skipped.push({
              program: label,
              reason: "ranking_name, rank ou academic_year absent",
            });
            continue;
          }

          const record = await tx.rankingRecord.upsert({
            where: {
              programId_academic_year_ranking_name: {
                programId,
                academic_year: academicYear,
                ranking_name: rankingName,
              },
            },
            create: {
              programId,
              academic_year: academicYear,
              ranking_name: rankingName,
              rank,
              source_url: (d.source_url as string) ?? null,
            },
            update: {
              rank,
              source_url: (d.source_url as string) ?? null,
            },
          });
          records.push(record);

        } else if (category === "Capacity") {
          const spotsAvailable = d.spots_available as number;
          const academicYear = d.academic_year as number;
          if (spotsAvailable == null || !academicYear) {
            skipped.push({
              program: label,
              reason: "spots_available ou academic_year absent",
            });
            continue;
          }

          // La capacité varie PAR CAMPUS. L'ancien code prenait la première
          // association venue (findFirst sans orderBy) : pour un programme
          // ouvert sur plusieurs campus, le nombre de places était écrit sur un
          // campus indéterminé, et l'ordre renvoyé par PostgreSQL sans ORDER BY
          // n'est même pas stable. On exige désormais un campus identifiable.
          const associations = await tx.programCampus.findMany({
            where: { programId },
            include: { campus: true },
            orderBy: { campusId: "asc" },
          });

          if (associations.length === 0) {
            skipped.push({
              program: label,
              reason: "aucun campus rattaché à ce programme",
            });
            continue;
          }

          const campusId = (d.campus_id as string | undefined) ?? null;
          const campusName = (d.campus_name as string | undefined) ?? null;

          let programCampus: (typeof associations)[number] | null = null;

          if (campusId) {
            programCampus = associations.find((a) => a.campusId === campusId) ?? null;
            if (!programCampus) {
              skipped.push({
                program: label,
                reason: `campus ${campusId} non rattaché à ce programme`,
              });
              continue;
            }
          } else if (campusName) {
            const needle = campusName.trim().toLowerCase();
            const matches = associations.filter(
              (a) => a.campus.name.trim().toLowerCase() === needle
            );
            if (matches.length !== 1) {
              skipped.push({
                program: label,
                reason: `campus « ${campusName} » introuvable ou ambigu`,
              });
              continue;
            }
            programCampus = matches[0];
          } else if (associations.length === 1) {
            // Un seul campus : aucune ambiguïté possible.
            programCampus = associations[0];
          } else {
            skipped.push({
              program: label,
              reason: `programme ouvert sur ${associations.length} campus et campus non précisé — import refusé pour éviter une donnée fausse`,
            });
            continue;
          }

          const record = await tx.capacityRecord.upsert({
            where: {
              programCampusId_academic_year: {
                programCampusId: programCampus.id,
                academic_year: academicYear,
              },
            },
            create: {
              programCampusId: programCampus.id,
              academic_year: academicYear,
              spots_available: spotsAvailable,
              source_url: (d.source_url as string) ?? null,
            },
            update: {
              spots_available: spotsAvailable,
              source_url: (d.source_url as string) ?? null,
            },
          });
          records.push(record);
        }
      }

      // Ne clore le ticket QUE si une donnée a réellement été écrite.
      // Auparavant cette mise à jour était inconditionnelle : un ticket dont
      // toutes les entrées étaient écartées repartait en "Validated" avec
      // « 0 Record(s) créé(s) », et la contribution était perdue sans erreur.
      if (records.length > 0) {
        await tx.contributionInbox.update({
          where: { id: ticket.id },
          data: { status: STATUS_VALIDATED },
        });
      }

      return records;
    });

    if (results.length === 0) {
      return NextResponse.json(
        {
          error:
            "Aucune donnée n'a pu être importée : le ticket reste ouvert pour correction.",
          skipped,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      message: `${results.length} ${category}Record(s) créé(s)/mis à jour`,
      count: results.length,
      skipped,
    });
  } catch (error) {
    console.error(`Transaction multi-programme ${category} échouée:`, error);
    return NextResponse.json(
      { error: "Erreur lors de la transaction multi-programme. Rollback effectué." },
      { status: 500 }
    );
  }
}
