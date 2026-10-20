/**
 * PUT et DELETE /api/admin/program-entries/[id] — Modifier ou supprimer une admission
 *
 * Plan gestion-contenu, étape 8 (D50), au motif des classements
 * (`rankings/[id]`) :
 * - PUT réécrit l'entrée entière, lue par `readEntry` (D48) avant toute
 *   lecture en base ; le programme ne change pas ; une autre entrée du même
 *   programme à la même année, au même niveau et par la même voie → 400 ;
 * - l'auteur vient de la session, jamais du corps ; l'origine est `MANUAL`
 *   (D49) ; les fiches sont revalidées après l'écriture (D26).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardManager } from "@/lib/auth";
import { revalidateContent } from "@/lib/content-cache";
import { DUPLICATE_ENTRY_ERROR, readEntry } from "@/lib/program-entries";
import { AUTHOR_SELECT, forManager, provenance } from "@/lib/provenance";
import { readJsonObject } from "@/lib/request-body";

export async function PUT(
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
    const existing = await prisma.programEntry.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Entrée introuvable" }, { status: 404 });
    }

    const { entry_year, required_level, route } = entry.value;
    const duplicate = await prisma.programEntry.findFirst({
      where: { programId: existing.programId, entry_year, required_level, route, NOT: { id } },
    });
    if (duplicate) {
      return NextResponse.json({ error: DUPLICATE_ENTRY_ERROR }, { status: 400 });
    }

    const updated = await prisma.programEntry.update({
      where: { id },
      data: { ...entry.value, ...provenance(session.user.id, "MANUAL") },
      include: { updatedBy: AUTHOR_SELECT },
    });

    revalidateContent();
    return NextResponse.json(forManager(updated));
  } catch (err) {
    if ((err as { code?: unknown })?.code === "P2002") {
      return NextResponse.json({ error: DUPLICATE_ENTRY_ERROR }, { status: 400 });
    }
    console.error(`PUT /api/admin/program-entries/${id} error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardManager();
  if (error) return error;

  const { id } = await params;

  try {
    const existing = await prisma.programEntry.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Entrée introuvable" }, { status: 404 });
    }

    await prisma.programEntry.delete({ where: { id } });

    revalidateContent();
    return NextResponse.json({ message: "Entrée supprimée" });
  } catch (err) {
    console.error(`DELETE /api/admin/program-entries/${id} error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
