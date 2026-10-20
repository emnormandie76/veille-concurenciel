/**
 * POST /api/admin/programs/[id]/entries — Une admission de plus pour un programme
 *
 * Plan gestion-contenu, étape 8 :
 * - D48 : l'envoi est lu par `readEntry` (lib/program-entries.ts) avant toute
 *   lecture en base ; un envoi illisible → 400, rien d'écrit ;
 * - D16 : une entrée par année, niveau et voie dans un programme ; un doublon
 *   → 400 ;
 * - D49 : le programme vient de l'URL et l'auteur de la session, jamais du
 *   corps ; l'origine est `MANUAL` ; le lien source suit D27 ;
 * - D26 : les fiches sont revalidées après l'écriture.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardManager } from "@/lib/auth";
import { revalidateContent } from "@/lib/content-cache";
import { DUPLICATE_ENTRY_ERROR, readEntry } from "@/lib/program-entries";
import { AUTHOR_SELECT, forManager, provenance } from "@/lib/provenance";
import { readJsonObject } from "@/lib/request-body";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await guardManager();
  if (error) return error;

  const { id } = await params;

  const body = await readJsonObject(request);
  if (!body) {
    return NextResponse.json({ error: "Le corps doit être un objet JSON. Rien n'a été écrit." }, { status: 400 });
  }
  const entry = readEntry(body);
  if (!entry.ok) {
    return NextResponse.json({ error: entry.error }, { status: 400 });
  }

  try {
    const program = await prisma.program.findUnique({ where: { id }, select: { id: true } });
    if (!program) {
      return NextResponse.json({ error: "Programme introuvable" }, { status: 404 });
    }

    const { entry_year, required_level, route } = entry.value;
    const duplicate = await prisma.programEntry.findUnique({
      where: { programId_entry_year_required_level_route: { programId: id, entry_year, required_level, route } },
    });
    if (duplicate) {
      return NextResponse.json({ error: DUPLICATE_ENTRY_ERROR }, { status: 400 });
    }

    const created = await prisma.programEntry.create({
      data: { programId: id, ...entry.value, ...provenance(session.user.id, "MANUAL") },
      include: { updatedBy: AUTHOR_SELECT },
    });

    revalidateContent();
    return NextResponse.json(forManager(created), { status: 201 });
  } catch (err) {
    // Un doublon arrivé entre la lecture et l'écriture : la clé unique le refuse.
    if ((err as { code?: unknown })?.code === "P2002") {
      return NextResponse.json({ error: DUPLICATE_ENTRY_ERROR }, { status: 400 });
    }
    console.error(`POST /api/admin/programs/${id}/entries error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
