/**
 * app/api/v1/schools/[id]/programs/route.ts
 *
 * GET /api/v1/schools/[id]/programs
 * Public API: Get list of programs for a school.
 * Optional ?campus_id= filter to get programs available at a specific campus.
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
    const campusId = searchParams.get("campus_id");

    // 1. Verify school exists and is ACTIVE
    const school = await prisma.school.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!school || school.status !== "ACTIVE") {
      return corsErrorResponse("École introuvable", 404);
    }

    // 2. Query programs at school level
    // Optional campus_id filter: find programs available at that campus via ProgramCampus
    const where: any = { schoolId: id };

    if (campusId) {
      where.campuses = {
        some: { campusId },
      };
    }

    const programs = await prisma.program.findMany({
      where,
      select: {
        id: true,
        schoolId: true,
        name: true,
        admission_exam: true,
        is_alternance_possible: true,
        is_expatriation_mandatory: true,
        min_expatriation_months: true,
        max_internship_months: true,
        source_url: true,
        ...API_PROVENANCE_SELECT,
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
      orderBy: { name: "asc" },
      // Plafond de sécurité : cette collection n'est pas paginée. La valeur est
      // très au-dessus de tout volume légitime — elle borne une requête
      // pathologique, elle ne tronque pas de donnée réelle.
      take: 500,
    });

    return corsResponse(programs);
  } catch (error) {
    console.error("GET /api/v1/schools/[id]/programs error:", error);
    return corsErrorResponse("Erreur serveur interne", 500);
  }
}
