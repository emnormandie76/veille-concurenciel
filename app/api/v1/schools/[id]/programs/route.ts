/**
 * app/api/v1/schools/[id]/programs/route.ts
 *
 * GET /api/v1/schools/[id]/programs
 * Public API: Get list of programs for a school, optionally filtered by campus_id.
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
    const campusId = searchParams.get("campus_id");

    // 1. Verify school exists and is ACTIVE
    const school = await prisma.school.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!school || school.status !== "ACTIVE") {
      return corsErrorResponse("École introuvable", 404);
    }

    // 2. Query programs
    const where: any = {
      campus: {
        schoolId: id,
      },
    };

    if (campusId) {
      where.campusId = campusId;
    }

    const programs = await prisma.program.findMany({
      where,
      select: {
        id: true,
        campusId: true,
        name: true,
        admission_exam: true,
        is_alternance_possible: true,
        is_expatriation_mandatory: true,
        min_expatriation_months: true,
        max_internship_months: true,
        campus: {
          select: {
            id: true,
            name: true,
            city: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    return corsResponse(programs);
  } catch (error) {
    console.error("GET /api/v1/schools/[id]/programs error:", error);
    return corsErrorResponse("Erreur serveur interne", 500);
  }
}
