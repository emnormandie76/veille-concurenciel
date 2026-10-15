/**
 * app/api/v1/rankings/route.ts
 *
 * GET /api/v1/rankings
 * Public API: Global rankings list with pagination and optional filters.
 * Supports query parameters: ranking_name, year, page, limit (defaults to 50).
 *
 * - Cache ISR 1h
 * - CORS enabled
 */

import { corsResponse, corsErrorResponse, parsePagination } from "@/lib/utils";
import { prisma } from "@/lib/prisma";

export const revalidate = 3600; // Cache 1h

export async function OPTIONS() {
  return corsResponse(null);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rankingName = searchParams.get("ranking_name") ?? "";
    const yearParam = searchParams.get("year");

    // Limite par défaut : 50 (absente, vide ou non numérique).
    const { page, limit, skip } = parsePagination(searchParams, 50);

    // Un programme appartient à une école, pas à un campus. Jusqu'au 14 octobre
    // 2026, ce filtre passait par `program.campus`, relation disparue avec la
    // refonte de Program : Prisma refusait la requête et la route répondait
    // toujours 500.
    const where: any = {
      program: {
        school: {
          status: "ACTIVE",
        },
      },
    };

    if (rankingName) {
      where.ranking_name = {
        contains: rankingName,
        mode: "insensitive",
      };
    }

    if (yearParam) {
      const year = parseInt(yearParam, 10);
      if (isNaN(year)) {
        return corsErrorResponse("Année invalide", 400);
      }
      where.academic_year = year;
    }

    const [rankings, total] = await Promise.all([
      prisma.rankingRecord.findMany({
        where,
        select: {
          id: true,
          programId: true,
          academic_year: true,
          ranking_name: true,
          rank: true,
          source_url: true,
          program: {
            select: {
              id: true,
              name: true,
              school: {
                select: {
                  id: true,
                  name: true,
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
                },
              },
            },
          },
        },
        orderBy: [
          { academic_year: "desc" },
          { ranking_name: "asc" },
          { rank: "asc" },
        ],
        skip,
        take: limit,
      }),
      prisma.rankingRecord.count({ where }),
    ]);

    return corsResponse({
      data: rankings,
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
    console.error("GET /api/v1/rankings error:", error);
    return corsErrorResponse("Erreur serveur interne", 500);
  }
}
