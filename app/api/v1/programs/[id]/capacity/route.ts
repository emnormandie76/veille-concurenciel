/**
 * app/api/v1/programs/[id]/capacity/route.ts
 *
 * GET /api/v1/programs/[id]/capacity
 * Public API: Get capacity history for a program, optionally filtered by year.
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

    // 1. Verify program exists and its school is ACTIVE
    const program = await prisma.program.findUnique({
      where: { id },
      select: {
        campus: {
          select: {
            school: {
              select: {
                status: true,
              },
            },
          },
        },
      },
    });

    if (!program || program.campus.school.status !== "ACTIVE") {
      return corsErrorResponse("Programme introuvable", 404);
    }

    // 2. Query capacity records
    const where: any = { programId: id };

    if (yearParam) {
      const year = parseInt(yearParam, 10);
      if (isNaN(year)) {
        return corsErrorResponse("Année invalide", 400);
      }
      where.academic_year = year;
    }

    const capacity = await prisma.capacityRecord.findMany({
      where,
      select: {
        id: true,
        programId: true,
        academic_year: true,
        spots_available: true,
        source_url: true,
      },
      orderBy: { academic_year: "desc" },
    });

    return corsResponse(capacity);
  } catch (error) {
    console.error("GET /api/v1/programs/[id]/capacity error:", error);
    return corsErrorResponse("Erreur serveur interne", 500);
  }
}
