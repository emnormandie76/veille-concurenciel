/**
 * app/api/v1/schools/[id]/accreditations/route.ts
 *
 * GET /api/v1/schools/[id]/accreditations
 * Public API: Get list of active accreditations for a school.
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

    // 1. Verify school exists and is ACTIVE
    const school = await prisma.school.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!school || school.status !== "ACTIVE") {
      return corsErrorResponse("École introuvable", 404);
    }

    // 2. Query accreditations (only active ones)
    const accreditations = await prisma.accreditationRecord.findMany({
      where: {
        schoolId: id,
        is_active: true,
      },
      select: {
        id: true,
        schoolId: true,
        accreditation_name: true,
        accreditation_type: true,
        year_obtained: true,
        is_active: true,
      },
      orderBy: { year_obtained: "desc" },
    });

    return corsResponse(accreditations);
  } catch (error) {
    console.error("GET /api/v1/schools/[id]/accreditations error:", error);
    return corsErrorResponse("Erreur serveur interne", 500);
  }
}
