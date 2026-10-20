/**
 * app/api/v1/campuses/[id]/route.ts
 *
 * GET /api/v1/campuses/[id]
 * Public API: Get campus details and its programs (via ProgramCampus).
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
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const campus = await prisma.campus.findUnique({
      where: { id },
      select: {
        id: true,
        schoolId: true,
        name: true,
        city: true,
        ...API_PROVENANCE_SELECT,
        school: {
          select: {
            status: true,
          },
        },
        programCampuses: {
          select: {
            id: true,
            program: {
              select: {
                id: true,
                schoolId: true,
                name: true,
                admission_exam: true,
                is_alternance_possible: true,
                is_expatriation_mandatory: true,
                min_expatriation_months: true,
                max_internship_months: true,
              },
            },
          },
          orderBy: { program: { name: "asc" } },
        },
      },
    });

    if (!campus || campus.school.status !== "ACTIVE") {
      return corsErrorResponse("Campus introuvable", 404);
    }

    // Remove school helper from returned response
    const { school, ...campusData } = campus;

    return corsResponse(campusData);
  } catch (error) {
    console.error("GET /api/v1/campuses/[id] error:", error);
    return corsErrorResponse("Erreur serveur interne", 500);
  }
}
