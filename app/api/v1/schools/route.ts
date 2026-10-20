/**
 * app/api/v1/schools/route.ts
 *
 * GET /api/v1/schools
 * Public API: Paged list of ACTIVE schools.
 * Supports query parameters: search, page, limit.
 *
 * - Cache ISR 1h
 * - CORS enabled
 */

import { corsResponse, corsErrorResponse, parsePagination } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { API_PROVENANCE_SELECT } from "@/lib/provenance";

export const revalidate = 3600; // Cache 1h

export async function OPTIONS() {
  return corsResponse(null);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? "";
    const { page, limit, skip } = parsePagination(searchParams);

    const where = {
      status: "ACTIVE" as const,
      ...(search
        ? {
            name: {
              contains: search,
              mode: "insensitive" as const,
            },
          }
        : {}),
    };

    const [schools, total] = await Promise.all([
      prisma.school.findMany({
        where,
        select: {
          id: true,
          name: true,
          official_domain: true,
          status: true,
          ...API_PROVENANCE_SELECT,
        },
        orderBy: { name: "asc" },
        skip,
        take: limit,
      }),
      prisma.school.count({ where }),
    ]);

    return corsResponse({
      data: schools,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
        has_next: page * limit < total,
        has_prev: page > 1,
      },
    });
  } catch (error) {
    console.error("GET /api/v1/schools error:", error);
    return corsErrorResponse("Erreur serveur interne", 500);
  }
}
