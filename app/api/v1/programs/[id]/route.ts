/**
 * app/api/v1/programs/[id]/route.ts
 *
 * GET /api/v1/programs/[id]
 * Public API: Get program details including school and associated campuses.
 *
 * - Cache ISR 1h
 * - CORS enabled
 * - Plan gestion-contenu, étape 8 (D53) : les admissions du programme
 *   (`entries`), imbriquées, avec la date seule de leur provenance (D25 revue).
 */

import { corsResponse, corsErrorResponse } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { ENTRY_API_SELECT, ENTRY_ORDER_BY } from "@/lib/program-entries";
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

    const program = await prisma.program.findUnique({
      where: { id },
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
        school: {
          select: {
            id: true,
            name: true,
            official_domain: true,
            status: true,
          },
        },
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
            capacityRecords: {
              orderBy: { academic_year: "desc" },
              take: 3,
              select: {
                id: true,
                academic_year: true,
                spots_available: true,
                source_url: true,
                ...API_PROVENANCE_SELECT,
              },
            },
          },
        },
        entries: {
          select: ENTRY_API_SELECT,
          orderBy: ENTRY_ORDER_BY,
        },
      },
    });

    if (!program || program.school.status !== "ACTIVE") {
      return corsErrorResponse("Programme introuvable", 404);
    }

    return corsResponse(program);
  } catch (error) {
    console.error("GET /api/v1/programs/[id] error:", error);
    return corsErrorResponse("Erreur serveur interne", 500);
  }
}
