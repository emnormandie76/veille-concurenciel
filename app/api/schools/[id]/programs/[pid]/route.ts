/**
 * app/api/schools/[id]/programs/[pid]/route.ts — GET /api/schools/[id]/programs/[pid]
 *
 * Lecture du site (session exigée par le proxy) : détail d'un programme
 * (tarifs, classements, capacité).
 * Filtre école ACTIVE obligatoire.
 *
 * - Cache ISR 1h
 * - Référence : architecture/gestion-contenu.md §4.3
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const revalidate = 3600; // ISR 1h — Étape 8.3

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; pid: string }> }
) {
  try {
    const { id: schoolId, pid } = await params;

    const program = await prisma.program.findUnique({
      where: { id: pid },
      include: {
        school: true,
        campuses: {
          include: {
            campus: {
              select: { id: true, name: true, city: true },
            },
            capacityRecords: {
              orderBy: { academic_year: "desc" },
            },
          },
        },
        pricingRecords: {
          orderBy: { academic_year: "desc" },
        },
        rankingRecords: {
          orderBy: [{ academic_year: "desc" }, { ranking_name: "asc" }],
        },
      },
    });

    if (!program) {
      return NextResponse.json({ error: "Programme introuvable" }, { status: 404 });
    }

    // Vérifier que le programme appartient bien à l'école demandée
    if (program.schoolId !== schoolId) {
      return NextResponse.json({ error: "Programme introuvable" }, { status: 404 });
    }

    // Vérifier que l'école est ACTIVE
    if (program.school.status !== "ACTIVE") {
      return NextResponse.json({ error: "École non disponible" }, { status: 404 });
    }

    return NextResponse.json(program);
  } catch (error) {
    console.error("GET /api/schools/[id]/programs/[pid] error:", error);
    return NextResponse.json({ error: "Erreur serveur interne" }, { status: 500 });
  }
}
