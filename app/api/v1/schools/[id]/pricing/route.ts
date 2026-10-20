/**
 * app/api/v1/schools/[id]/pricing/route.ts
 *
 * GET /api/v1/schools/[id]/pricing
 * Public API: Get pricing records for all programs of a school, optionally filtered by year.
 *
 * - Cache ISR 1h
 * - CORS enabled
 */

import { corsResponse, corsErrorResponse } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { API_PROVENANCE_SELECT } from "@/lib/provenance";

export const revalidate = 3600; // Cache 1h

export async function OPTIONS() {
  return corsResponse(null);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const yearParam = searchParams.get("year");

    // 1. Verify school exists and is ACTIVE
    const school = await prisma.school.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!school || school.status !== "ACTIVE") {
      return corsErrorResponse("École introuvable", 404);
    }

    // 2. Query pricing records
    // Un programme appartient à une école, pas à un campus. Jusqu'au 14 octobre
    // 2026, ce filtre passait par `program.campus`, relation disparue avec la
    // refonte de Program : Prisma refusait la requête et la route répondait
    // toujours 500.
    const where: any = {
      program: {
        schoolId: id,
      },
    };

    if (yearParam) {
      const year = parseInt(yearParam, 10);
      if (isNaN(year)) {
        return corsErrorResponse("Année invalide", 400);
      }
      where.academic_year = year;
    }

    const pricing = await prisma.pricingRecord.findMany({
      where,
      select: {
        id: true,
        programId: true,
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
        ...API_PROVENANCE_SELECT,
        program: {
          select: {
            id: true,
            name: true,
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
              },
            },
          },
        },
      },
      orderBy: [
        { academic_year: "desc" },
      ],
      // Plafond de sécurité : cette collection n'est pas paginée. La valeur est
      // très au-dessus de tout volume légitime — elle borne une requête
      // pathologique, elle ne tronque pas de donnée réelle.
      take: 500,
    });

    return corsResponse(pricing);
  } catch (error) {
    console.error("GET /api/v1/schools/[id]/pricing error:", error);
    return corsErrorResponse("Erreur serveur interne", 500);
  }
}
