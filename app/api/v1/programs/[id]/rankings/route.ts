/**
 * app/api/v1/programs/[id]/rankings/route.ts
 *
 * GET /api/v1/programs/[id]/rankings
 * Public API: Get rankings for a program, optionally filtered by year and/or ranking_name.
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
    const rankingName = searchParams.get("ranking_name");

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

    // 2. Query ranking records
    const where: any = { programId: id };

    if (yearParam) {
      const year = parseInt(yearParam, 10);
      if (isNaN(year)) {
        return corsErrorResponse("Année invalide", 400);
      }
      where.academic_year = year;
    }

    if (rankingName) {
      where.ranking_name = {
        contains: rankingName,
        mode: "insensitive",
      };
    }

    const rankings = await prisma.rankingRecord.findMany({
      where,
      select: {
        id: true,
        programId: true,
        academic_year: true,
        ranking_name: true,
        rank: true,
        source_url: true,
      },
      orderBy: [
        { academic_year: "desc" },
        { rank: "asc" },
      ],
    });

    return corsResponse(rankings);
  } catch (error) {
    console.error("GET /api/v1/programs/[id]/rankings error:", error);
    return corsErrorResponse("Erreur serveur interne", 500);
  }
}
