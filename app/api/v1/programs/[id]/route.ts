/**
 * app/api/v1/programs/[id]/route.ts
 *
 * GET /api/v1/programs/[id]
 * Public API: Get program details including campus and school.
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
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const program = await prisma.program.findUnique({
      where: { id },
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
            schoolId: true,
            name: true,
            city: true,
            school: {
              select: {
                id: true,
                name: true,
                official_domain: true,
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

    return corsResponse(program);
  } catch (error) {
    console.error("GET /api/v1/programs/[id] error:", error);
    return corsErrorResponse("Erreur serveur interne", 500);
  }
}
