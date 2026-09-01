/**
 * app/api/schools/[id]/route.ts — GET /api/schools/[id] (Étape 8.2)
 *
 * Route publique : détail d'une école avec campus, programmes, stats, accréditations.
 * Filtre status = ACTIVE obligatoire.
 *
 * - Cache ISR 1h (Étape 8.3)
 * - Référence : task.md §8.2
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const revalidate = 3600; // ISR 1h — Étape 8.3

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const school = await prisma.school.findUnique({
      where: { id },
      include: {
        campuses: {
          orderBy: { name: "asc" },
        },
        programs: {
          include: {
            campuses: {
              include: {
                campus: {
                  select: {
                    id: true,
                    name: true,
                    city: true,
                  },
                },
              },
            },
            pricingRecords: {
              orderBy: { academic_year: "desc" },
              take: 5,
            },
            rankingRecords: {
              orderBy: { academic_year: "desc" },
              take: 10,
            },
          },
          orderBy: { name: "asc" },
        },
        statsRecords: {
          orderBy: { academic_year: "desc" },
          take: 3,
        },
        accreditations: {
          orderBy: { year_obtained: "desc" },
        },
      },
    });

    if (!school) {
      return NextResponse.json({ error: "École introuvable" }, { status: 404 });
    }

    // Filtrer les écoles non actives
    if (school.status !== "ACTIVE") {
      return NextResponse.json({ error: "École non disponible" }, { status: 404 });
    }

    return NextResponse.json(school);
  } catch (error) {
    console.error("GET /api/schools/[id] error:", error);
    return NextResponse.json({ error: "Erreur serveur interne" }, { status: 500 });
  }
}