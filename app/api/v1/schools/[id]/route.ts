/**
 * app/api/v1/schools/[id]/route.ts
 *
 * GET /api/v1/schools/[id]
 * Public API: Get base school details by ID.
 * Returns 404 if not found or if the school is not ACTIVE.
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

    const school = await prisma.school.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        official_domain: true,
        status: true,
        ...API_PROVENANCE_SELECT,
      },
    });

    if (!school || school.status !== "ACTIVE") {
      return corsErrorResponse("École introuvable", 404);
    }

    return corsResponse(school);
  } catch (error) {
    console.error("GET /api/v1/schools/[id] error:", error);
    return corsErrorResponse("Erreur serveur interne", 500);
  }
}
