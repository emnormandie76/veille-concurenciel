/**
 * app/api/v1/schools/[id]/campuses/route.ts
 *
 * GET /api/v1/schools/[id]/campuses
 * Public API: Get list of campuses for a school.
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

    // 2. Query campuses
    const campuses = await prisma.campus.findMany({
      where: { schoolId: id },
      select: {
        id: true,
        schoolId: true,
        name: true,
        city: true,
      },
      orderBy: { name: "asc" },
    });

    return corsResponse(campuses);
  } catch (error) {
    console.error("GET /api/v1/schools/[id]/campuses error:", error);
    return corsErrorResponse("Erreur serveur interne", 500);
  }
}
