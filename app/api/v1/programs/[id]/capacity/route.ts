/**
 * app/api/v1/programs/[id]/capacity/route.ts
 *
 * GET /api/v1/programs/[id]/capacity
 * Public API: Get capacity history for a program, grouped by campus.
 * Capacity varies per campus (via ProgramCampus).
 * Optionally filtered by year.
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
        school: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!program || program.school.status !== "ACTIVE") {
      return corsErrorResponse("Programme introuvable", 404);
    }

    // 2. Build year filter for capacityRecords
    const capacityWhere: any = {};
    if (yearParam) {
      const year = parseInt(yearParam, 10);
      if (isNaN(year)) {
        return corsErrorResponse("Année invalide", 400);
      }
      capacityWhere.academic_year = year;
    }

    // 3. Query capacity records grouped by campus (via ProgramCampus)
    const programCampuses = await prisma.programCampus.findMany({
      where: { programId: id },
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
          where: capacityWhere,
          select: {
            id: true,
            academic_year: true,
            spots_available: true,
            source_url: true,
          },
          orderBy: { academic_year: "desc" },
        },
      },
      orderBy: { campus: { name: "asc" } },
      // Plafond de sécurité : cette collection n'est pas paginée. La valeur est
      // très au-dessus de tout volume légitime — elle borne une requête
      // pathologique, elle ne tronque pas de donnée réelle.
      take: 500,
    });

    return corsResponse(programCampuses);
  } catch (error) {
    console.error("GET /api/v1/programs/[id]/capacity error:", error);
    return corsErrorResponse("Erreur serveur interne", 500);
  }
}
