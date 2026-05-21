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
    const where: any = {
      program: {
        campus: {
          schoolId: id,
        },
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
        program: {
          select: {
            id: true,
            name: true,
            campus: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: [
        { academic_year: "desc" },
      ],
    });

    return corsResponse(pricing);
  } catch (error) {
    console.error("GET /api/v1/schools/[id]/pricing error:", error);
    return corsErrorResponse("Erreur serveur interne", 500);
  }
}
