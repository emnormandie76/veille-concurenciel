/**
 * app/api/schools/[id]/programs/[pid]/route.ts — GET /api/schools/[id]/programs/[pid] (Étape 8.2)
 *
 * Route publique : détail d'un programme (tarifs, classements, capacité).
 * Filtre école ACTIVE obligatoire.
 *
 * - Cache ISR 1h (Étape 8.3)
 * - Référence : task.md §8.2
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
        campus: {
          include: {
            school: true,
          },
        },
        pricingRecords: {
          orderBy: { academic_year: "desc" },
        },
        rankingRecords: {
          orderBy: [{ academic_year: "desc" }, { ranking_name: "asc" }],
        },
        capacityRecords: {
          orderBy: { academic_year: "desc" },
        },
      },
    });

    if (!program) {
      return NextResponse.json({ error: "Programme introuvable" }, { status: 404 });
    }

    // Vérifier que le programme appartient bien à l'école demandée
    if (program.campus.schoolId !== schoolId) {
      return NextResponse.json({ error: "Programme introuvable" }, { status: 404 });
    }

    // Vérifier que l'école est ACTIVE
    if (program.campus.school.status !== "ACTIVE") {
      return NextResponse.json({ error: "École non disponible" }, { status: 404 });
    }

    return NextResponse.json(program);
  } catch (error) {
    console.error("GET /api/schools/[id]/programs/[pid] error:", error);
    return NextResponse.json({ error: "Erreur serveur interne" }, { status: 500 });
  }
}
