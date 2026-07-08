/**
 * app/api/v1/programs/route.ts
 *
 * GET /api/v1/programs
 * Public API: Global program search with filters and pagination.
 * Supports query parameters: search, admission_exam, alternance, page, limit.
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
    const search = searchParams.get("search") ?? "";
    const admissionExam = searchParams.get("admission_exam") ?? "";
    const alternance = searchParams.get("alternance");
    const { page, limit, skip } = parsePagination(searchParams);

    const where: any = {
      school: {
        status: "ACTIVE",
      },
    };

    if (alternance !== null) {
      where.is_alternance_possible = alternance === "true";
    }

    if (admissionExam) {
      where.admission_exam = {
        contains: admissionExam,
        mode: "insensitive",
      };
    }

    if (search) {
      where.OR = [
        {
          name: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          school: {
            name: {
              contains: search,
              mode: "insensitive",
            },
          },
        },
      ];
    }

    const [programs, total] = await Promise.all([
      prisma.program.findMany({
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
          school: {
            select: {
              id: true,
              name: true,
              official_domain: true,
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
        orderBy: { name: "asc" },
        skip,
        take: limit,
      }),
      prisma.program.count({ where }),
    ]);

    return corsResponse({
      data: programs,
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
    console.error("GET /api/v1/programs error:", error);
    return corsErrorResponse("Erreur serveur interne", 500);
  }
}
