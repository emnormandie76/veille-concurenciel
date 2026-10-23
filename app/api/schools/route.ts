/**
 * app/api/schools/route.ts — GET /api/schools
 *
 * Liste des écoles ACTIVE avec recherche et pagination, pour la page d'accueil.
 * Session exigée par le proxy, comme tout le site (plan gestion-contenu,
 * étape 1).
 *
 * - Filtre status = ACTIVE obligatoire (architecture/gestion-contenu.md §4.3)
 * - Inclut campuses + programs pour la navigation
 * - `programs_count` : tous les programmes de l'école, avec ou sans campus,
 *   ceux de sa fiche (plan gestion-contenu, D75 : l'accueil les comptait à
 *   travers les campus, 51 pour 46)
 * - Dynamique : la recherche et la page se lisent dans l'adresse (`request.url`),
 *   la liste ne peut pas être prérendue. Le `revalidate = 3600` d'avant (étape 8.3
 *   du plan backend-local) faisait essayer le build, qui journalisait « Dynamic
 *   server usage » ; retiré à l'étape 15 (plan gestion-contenu)
 * - Référence : architecture/gestion-contenu.md §4.3
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? "";
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "20")));
    const skip = (page - 1) * limit;

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
          _count: { select: { programs: true } },
          campuses: {
            select: {
              id: true,
              name: true,
              city: true,
              programCampuses: {
                select: {
                  program: {
                    select: {
                      id: true,
                      name: true,
                      admission_exam: true,
                      is_alternance_possible: true,
                      is_expatriation_mandatory: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { name: "asc" },
        skip,
        take: limit,
      }),
      prisma.school.count({ where }),
    ]);

    const formattedSchools = schools.map((school) => ({
      id: school.id,
      name: school.name,
      official_domain: school.official_domain,
      status: school.status,
      programs_count: school._count.programs,
      campuses: school.campuses.map((campus) => ({
        id: campus.id,
        name: campus.name,
        city: campus.city,
        programs: campus.programCampuses
          .map((pc) => pc.program)
          .filter((p): p is {
            id: string;
            name: string;
            admission_exam: string | null;
            is_alternance_possible: boolean;
            is_expatriation_mandatory: boolean;
          } => p !== null),
      })),
    }));

    return NextResponse.json({
      data: formattedSchools,
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
    console.error("GET /api/schools error:", error);
    return NextResponse.json({ error: "Erreur serveur interne" }, { status: 500 });
  }
}