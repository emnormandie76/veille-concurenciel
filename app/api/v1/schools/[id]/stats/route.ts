/**
 * app/api/v1/schools/[id]/stats/route.ts
 *
 * GET /api/v1/schools/[id]/stats
 * Public API: Get school statistics.
 * Supports query parameters: year (optional, defaults to the most recent year).
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

    // 2. Query stats
    let statsRecord;
    if (yearParam) {
      const year = parseInt(yearParam, 10);
      if (isNaN(year)) {
        return corsErrorResponse("Année invalide", 400);
      }
      statsRecord = await prisma.schoolStatsRecord.findUnique({
        where: {
          schoolId_academic_year: {
            schoolId: id,
            academic_year: year,
          },
        },
        select: {
          id: true,
          schoolId: true,
          academic_year: true,
          total_students: true,
          total_alumni: true,
          partner_companies: true,
          annual_internship_offers: true,
          abroad_campuses: true,
          partner_universities: true,
          permanent_professors: true,
          international_professors_pct: true,
          external_speakers_pct: true,
          source_url: true,
          ...API_PROVENANCE_SELECT,
        },
      });
    } else {
      statsRecord = await prisma.schoolStatsRecord.findFirst({
        where: { schoolId: id },
        orderBy: { academic_year: "desc" },
        select: {
          id: true,
          schoolId: true,
          academic_year: true,
          total_students: true,
          total_alumni: true,
          partner_companies: true,
          annual_internship_offers: true,
          abroad_campuses: true,
          partner_universities: true,
          permanent_professors: true,
          international_professors_pct: true,
          external_speakers_pct: true,
          source_url: true,
          ...API_PROVENANCE_SELECT,
        },
      });
    }

    if (!statsRecord) {
      return corsErrorResponse("Statistiques introuvables", 404);
    }

    return corsResponse(statsRecord);
  } catch (error) {
    console.error("GET /api/v1/schools/[id]/stats error:", error);
    return corsErrorResponse("Erreur serveur interne", 500);
  }
}
