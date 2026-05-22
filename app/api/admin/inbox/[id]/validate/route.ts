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

import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
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

interface AccreditationJson {
  accreditation_name: string;
  year_obtained: number;
  is_active?: boolean;
}

// ──────────────────────────────────────────────
// Handler principal
// ──────────────────────────────────────────────

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

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
// Program_Discovery — Transaction atomique Campus + Programs
// Référence : task.md §3.2, architecture.md §5.2
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

      // 2. Préparation des upserts de programmes en parallèle
      const programPromises: Promise<any>[] = [];
      const createdCampuses: Array<{ campusId: string; campusName: string; programsCreated: number }> = [];

      for (const item of campusResults) {
        if (!item) continue;
        const { campusData, campus } = item;
        let programsCreated = 0;

        if (Array.isArray(campusData.programs)) {
          for (const prog of campusData.programs) {
            if (!prog.name) continue;
            programsCreated++;
            programPromises.push(
              tx.program.upsert({
                where: {
                  campusId_name: {
                    campusId: campus.id,
                    name: prog.name,
                  },
                },
                create: {
                  campusId: campus.id,
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
              })
            );
          }
        }

        createdCampuses.push({
          campusId: campus.id,
          campusName: campus.name,
          programsCreated,
        });
      }

      // Exécuter tous les upserts de programmes en parallèle
      await Promise.all(programPromises);

      // Marquer le ticket comme validé
      await tx.contributionInbox.update({
        where: { id: ticket.id },
        data: { status: "Validated" },
      });

      return createdCampuses;
    }, {
      timeout: 60000, // 60s timeout pour les imports volumineux (ex: EDHEC avec 9 campus et 30+ programmes)
    });

    return NextResponse.json({
      message: "Program_Discovery validé avec succès",
      campuses_created: result,
    });
  } catch (error) {
    console.error("Transaction Program_Discovery échouée:", error);
    // Rollback automatique par Prisma $transaction
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

  const record = await prisma.pricingRecord.upsert({
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
  });

  await prisma.contributionInbox.update({
    where: { id: ticket.id },
    data: { status: "Validated" },
  });

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

  const record = await prisma.rankingRecord.upsert({
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
  });

  await prisma.contributionInbox.update({
    where: { id: ticket.id },
    data: { status: "Validated" },
  });

  return NextResponse.json({ message: "RankingRecord créé/mis à jour", record });
}

// ──────────────────────────────────────────────
// Capacity — Upsert CapacityRecord [programId, academic_year]
// ──────────────────────────────────────────────

async function validateCapacity(
  ticket: { id: string; programId: string | null },
  data: CapacityJson
) {
  if (!ticket.programId) {
    return NextResponse.json({ error: "programId manquant pour un ticket Capacity" }, { status: 400 });
  }
  if (!data.spots_available || !data.academic_year) {
    return NextResponse.json({ error: "spots_available et academic_year sont requis" }, { status: 400 });
  }

  const record = await prisma.capacityRecord.upsert({
    where: {
      programId_academic_year: {
        programId: ticket.programId,
        academic_year: data.academic_year,
      },
    },
    create: {
      programId: ticket.programId,
      academic_year: data.academic_year,
      spots_available: data.spots_available,
      source_url: data.source_url ?? null,
    },
    update: {
      spots_available: data.spots_available,
      source_url: data.source_url ?? null,
    },
  });

  await prisma.contributionInbox.update({
    where: { id: ticket.id },
    data: { status: "Validated" },
  });

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

  const record = await prisma.schoolStatsRecord.upsert({
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
  });

  await prisma.contributionInbox.update({
    where: { id: ticket.id },
    data: { status: "Validated" },
  });

  return NextResponse.json({ message: "SchoolStatsRecord créé/mis à jour", record });
}

// ──────────────────────────────────────────────
// Accreditation — Upsert AccreditationRecord [schoolId, accreditation_name]
// ──────────────────────────────────────────────

async function validateAccreditation(
  ticket: { id: string; schoolId: string | null },
  data: AccreditationJson
) {
  if (!ticket.schoolId) {
    return NextResponse.json({ error: "schoolId manquant pour un ticket Accreditation" }, { status: 400 });
  }
  if (!data.accreditation_name || !data.year_obtained) {
    return NextResponse.json(
      { error: "accreditation_name et year_obtained sont requis" },
      { status: 400 }
    );
  }

  const record = await prisma.accreditationRecord.upsert({
    where: {
      schoolId_accreditation_name: {
        schoolId: ticket.schoolId,
        accreditation_name: data.accreditation_name,
      },
    },
    create: {
      schoolId: ticket.schoolId,
      accreditation_name: data.accreditation_name,
      year_obtained: data.year_obtained,
      is_active: data.is_active ?? true,
    },
    update: {
      year_obtained: data.year_obtained,
      is_active: data.is_active ?? true,
    },
  });

  await prisma.contributionInbox.update({
    where: { id: ticket.id },
    data: { status: "Validated" },
  });

  return NextResponse.json({ message: "AccreditationRecord créé/mis à jour", record });
}
