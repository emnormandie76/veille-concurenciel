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

import { guardAuth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

interface RankingJson {
  ranking_name: string;
  rank: number;
  academic_year: number;
  source_url?: string | null;
  data_conflict_warning?: boolean;
}

interface CapacityJson {
  spots_available: number;
  academic_year: number;
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
  year_obtained?: number;
  is_active?: boolean;
  source_url?: string | null;
}

interface AccreditationJson {
  // Nouveau format : tableau de toutes les accréditations
  accreditations?: AccreditationItem[];
  // Ancien format single-object (rétrocompatibilité)
  accreditation_name?: string;
  accreditation_type?: "international" | "label" | "state";
  year_obtained?: number;
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
  const { error } = await guardAuth();
  if (error) return error;

  const { id } = await params;

  try {
    const ticket = await prisma.contributionInbox.findUnique({ where: { id } });

    if (!ticket) {
      return NextResponse.json({ error: "Ticket introuvable" }, { status: 404 });
    }

    if (ticket.status === "Validated") {
      return NextResponse.json({ error: "Ticket déjà validé" }, { status: 400 });
    }

    if (ticket.status === "Rejected") {
      return NextResponse.json(
        { error: "Impossible de valider un ticket rejeté" },
        { status: 400 }
      );
    }

    // Le body peut contenir des données modifiées par l'Admin (formulaire répéteur)
    let bodyData: Record<string, unknown> = {};
    try {
      bodyData = await request.json();
    } catch {
      // Pas de body JSON = on utilise le ai_extracted_json du ticket directement
    }

    // Fusionner : bodyData prioritaire sur ai_extracted_json
    const rawJson = (bodyData && Object.keys(bodyData).length > 0)
      ? bodyData
      : ticket.ai_extracted_json;

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
      // 1. Upsert de tous les campus en parallèle
      const campusResults = await Promise.all(
        data.discovered_campuses.map(async (campusData) => {
          if (!campusData.name) return null;
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
          return { campusData, campus };
        })
      );

      // 2. Upsert des programmes au niveau école + création des ProgramCampus
      const programCampusPromises: Promise<any>[] = [];
      const stats: Array<{ campusId: string; campusName: string; programsLinked: number }> = [];

      for (const item of campusResults) {
        if (!item) continue;
        const { campusData, campus } = item;
        let programsLinked = 0;

        if (Array.isArray(campusData.programs)) {
          for (const prog of campusData.programs) {
            if (!prog.name) continue;
            programsLinked++;

            // Upsert du programme au niveau école
            // @@unique([schoolId, name]) garantit la déduplication
            const programUpsert = tx.program.upsert({
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
            // Enchaîné après l'upsert du programme pour avoir son id
            programCampusPromises.push(
              programUpsert.then((program) =>
                tx.programCampus.upsert({
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
                })
              )
            );
          }
        }

        stats.push({
          campusId: campus.id,
          campusName: campus.name,
          programsLinked,
        });
      }

      // Exécuter tous les upserts programme+campus en parallèle
      await Promise.all(programCampusPromises);

      // Marquer le ticket comme validé
      await tx.contributionInbox.update({
        where: { id: ticket.id },
        data: { status: "Validated" },
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
      data: { status: "Validated" },
    }),
  ]);

  return NextResponse.json({ message: "PricingRecord créé/mis à jour", record });
}

// ──────────────────────────────────────────────
// Ranking — Upsert RankingRecord [programId, academic_year, ranking_name]
// ──────────────────────────────────────────────

async function validateRanking(
  ticket: { id: string; programId: string | null },
  data: RankingJson
) {
  if (!ticket.programId) {
    return NextResponse.json({ error: "programId manquant pour un ticket Ranking" }, { status: 400 });
  }
  if (!data.ranking_name || !data.rank || !data.academic_year) {
    return NextResponse.json({ error: "ranking_name, rank et academic_year sont requis" }, { status: 400 });
  }

  // Upsert et clôture du ticket dans UNE SEULE transaction. Séparés, un échec
  // du second appel laissait la donnée écrite et le ticket ouvert : l'admin
  // revalidait et écrasait.
  const [record] = await prisma.$transaction([
    prisma.rankingRecord.upsert({
      where: {
        programId_academic_year_ranking_name: {
          programId: ticket.programId,
          academic_year: data.academic_year,
          ranking_name: data.ranking_name,
        },
      },
      create: {
        programId: ticket.programId,
        academic_year: data.academic_year,
        ranking_name: data.ranking_name,
        rank: data.rank,
        source_url: data.source_url ?? null,
      },
      update: {
        rank: data.rank,
        source_url: data.source_url ?? null,
      },
    }),
    prisma.contributionInbox.update({
      where: { id: ticket.id },
      data: { status: "Validated" },
    }),
  ]);

  return NextResponse.json({ message: "RankingRecord créé/mis à jour", record });
}

// ──────────────────────────────────────────────
// Capacity — Upsert CapacityRecord [programCampusId, academic_year]
// La capacity varie par campus. On utilise programCampusId.
// Si le ticket a programCampusId directement (pipeline auto), on l'utilise.
// Sinon on le résout depuis (programId, campusId) (crowdsourcing).
// ──────────────────────────────────────────────

async function validateCapacity(
  ticket: { id: string; programId: string | null; programCampusId: string | null; campusId: string | null },
  data: CapacityJson
) {
  // == null et non !valeur : 0 place (formation fermée) est une donnée valide.
  if (data.spots_available == null || !data.academic_year) {
    return NextResponse.json({ error: "spots_available et academic_year sont requis" }, { status: 400 });
  }

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

  // Upsert et clôture du ticket dans UNE SEULE transaction. Séparés, un échec
  // du second appel laissait la donnée écrite et le ticket ouvert : l'admin
  // revalidait et écrasait.
  const [record] = await prisma.$transaction([
    prisma.capacityRecord.upsert({
      where: {
        programCampusId_academic_year: {
          programCampusId,
          academic_year: data.academic_year,
        },
      },
      create: {
        programCampusId,
        academic_year: data.academic_year,
        spots_available: data.spots_available,
        source_url: data.source_url ?? null,
      },
      update: {
        spots_available: data.spots_available,
        source_url: data.source_url ?? null,
      },
    }),
    prisma.contributionInbox.update({
      where: { id: ticket.id },
      data: { status: "Validated" },
    }),
  ]);

  return NextResponse.json({ message: "CapacityRecord créé/mis à jour", record });
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
      data: { status: "Validated" },
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
  // Whitelist d'éléments 'international' connus
  const INTERNATIONAL_NAMES = new Set(["equis", "aacsb", "amba", "epas", "bsis", "abet", "fibaa"]);
  const STATE_NAMES = new Set(["cti", "cefdg", "grade de master", "grade de licence", "hceres"]);

  const inferType = (name: string): "international" | "label" | "state" => {
    const n = name.toLowerCase();
    if (INTERNATIONAL_NAMES.has(n) || INTERNATIONAL_NAMES.has(n.split(" ")[0])) return "international";
    if (STATE_NAMES.has(n) || n.includes("grade de") || n.includes("cti")) return "state";
    return "label";
  };

  let accreditationItems: Array<{
    accreditation_name: string;
    accreditation_type: "international" | "label" | "state";
    year_obtained: number;
    is_active: boolean;
  }>;

  if (data.accreditations && Array.isArray(data.accreditations) && data.accreditations.length > 0) {
    // Nouveau format : liste
    accreditationItems = data.accreditations
      .filter((item) => item.accreditation_name)
      .map((item) => ({
        accreditation_name: item.accreditation_name,
        accreditation_type: item.accreditation_type ?? inferType(item.accreditation_name),
        year_obtained: item.year_obtained ?? 0,
        is_active: item.is_active ?? true,
      }));
  } else if (data.accreditation_name) {
    // Ancien format : objet unique (rétrocompatibilité)
    accreditationItems = [{
      accreditation_name: data.accreditation_name,
      accreditation_type: data.accreditation_type ?? inferType(data.accreditation_name),
      year_obtained: data.year_obtained ?? 0,
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
      data: { status: "Validated" },
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
          data: { status: "Validated" },
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
