/**
 * app/api/v1/compare/programs/route.ts
 *
 * GET /api/v1/compare/programs
 * Public API: Compare up to 5 programs side by side (pricing, rankings, capacity).
 * Supports query parameters: ids (comma-separated list of UUIDs).
 *
 * - Cache ISR 1h
 * - CORS enabled
 */

import { corsResponse, corsErrorResponse } from "@/lib/utils";
import { prisma } from "@/lib/prisma";

export const revalidate = 3600; // Cache 1h

export async function OPTIONS() {
  return corsResponse(null);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const idsParam = searchParams.get("ids");

    if (!idsParam) {
      return corsErrorResponse("Paramètre ids manquant", 400);
    }

    const idList = idsParam
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (idList.length === 0) {
      return corsErrorResponse("Aucun identifiant de programme fourni", 400);
    }

    if (idList.length > 5) {
      return corsErrorResponse(
        "Maximum 5 programmes autorisés pour la comparaison",
        400
      );
    }

    const programs = await prisma.program.findMany({
      where: {
        id: { in: idList },
        school: {
          status: "ACTIVE",
        },
      },
      select: {
        id: true,
        schoolId: true,
        name: true,
        admission_exam: true,
        is_alternance_possible: true,
        is_expatriation_mandatory: true,
        min_expatriation_months: true,
        max_internship_months: true,
        school: {
          select: {
            id: true,
            name: true,
            official_domain: true,
          },
        },
        campuses: {
          select: {
            id: true,
            campus: {
              select: {
                id: true,
                name: true,
                city: true,
              },
            },
            capacityRecords: {
              select: {
                id: true,
                academic_year: true,
                spots_available: true,
                source_url: true,
              },
              orderBy: { academic_year: "desc" },
            },
          },
        },
        pricingRecords: {
          select: {
            id: true,
            academic_year: true,
            currency: true,
            year_1_fee: true,
            year_2_fee: true,
            year_3_fee: true,
            year_4_fee: true,
            year_5_fee: true,
            total_fee: true,
            intl_year_1_fee: true,
            intl_total_fee: true,
            intl_currency: true,
            additional_fees_notes: true,
            source_url: true,
          },
          orderBy: { academic_year: "desc" },
        },
        rankingRecords: {
          select: {
            id: true,
            academic_year: true,
            ranking_name: true,
            rank: true,
            source_url: true,
          },
          orderBy: [{ academic_year: "desc" }, { ranking_name: "asc" }],
        },
      },
    });

    if (programs.length !== idList.length) {
      return corsErrorResponse(
        "Un ou plusieurs programmes sont introuvables ou inactifs",
        404
      );
    }

    // Reorder programs to match the input order of ids
    const orderedPrograms = idList
      .map((id) => programs.find((p) => p.id === id))
      .filter(Boolean);

    return corsResponse(orderedPrograms);
  } catch (error) {
    console.error("GET /api/v1/compare/programs error:", error);
    return corsErrorResponse("Erreur serveur interne", 500);
  }
}
