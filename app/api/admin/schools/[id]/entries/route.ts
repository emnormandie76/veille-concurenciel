/**
 * GET /api/admin/schools/[id]/entries — Les admissions des programmes d'une école
 *
 * Plan gestion-contenu, étape 8 (D50) : l'onglet « Admissions » lit ici, au
 * motif des classements (`schools/[id]/rankings`) ; `?programId=` restreint à
 * un programme. Chaque ligne porte « Modifié par … le … » (D29, D49), le nom
 * seul : ni l'identifiant de l'auteur ni l'origine ne partent vers le
 * navigateur (`forManager`).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardManager } from "@/lib/auth";
import { ENTRY_ORDER_BY } from "@/lib/program-entries";
import { AUTHOR_SELECT, forManager } from "@/lib/provenance";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardManager();
  if (error) return error;

  const { id } = await params;
  const programId = new URL(request.url).searchParams.get("programId");

  try {
    const school = await prisma.school.findUnique({ where: { id } });
    if (!school) {
      return NextResponse.json({ error: "École introuvable" }, { status: 404 });
    }

    const entries = await prisma.programEntry.findMany({
      where: { program: { schoolId: id }, ...(programId ? { programId } : {}) },
      include: {
        updatedBy: AUTHOR_SELECT,
        program: { select: { id: true, name: true } },
      },
      orderBy: [{ program: { name: "asc" } }, ...ENTRY_ORDER_BY],
    });

    return NextResponse.json(entries.map(forManager));
  } catch (err) {
    console.error(`GET /api/admin/schools/${id}/entries error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
