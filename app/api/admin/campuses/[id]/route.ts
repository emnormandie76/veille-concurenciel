import { guardManager } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { revalidateContent } from "@/lib/content-cache";
import { provenance } from "@/lib/provenance";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await guardManager();
  if (error) return error;

  const { id } = await params;

  try {
    const body = await request.json();
    const { name, city } = body;

    if (!name && city === undefined) {
      return NextResponse.json(
        { error: "Au moins un champ (nom ou ville) doit être fourni pour la mise à jour" },
        { status: 400 }
      );
    }

    // Un nom fourni ne peut pas être vide une fois nettoyé. Jusqu'au 14 octobre
    // 2026, un nom fait d'espaces passait et une chaîne vide était écrite
    // (décision 12, plan backend-local).
    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      return NextResponse.json(
        { error: "Le nom du campus ne peut pas être vide" },
        { status: 400 }
      );
    }

    // Récupérer le campus existant
    const campus = await prisma.campus.findUnique({
      where: { id },
    });

    if (!campus) {
      return NextResponse.json({ error: "Campus introuvable" }, { status: 404 });
    }

    const data: Record<string, string | null> = {};
    if (name) data.name = name.trim();
    if (city !== undefined) data.city = city ? city.trim() : null;

    // Si le nom change, vérifier l'unicité @@unique([schoolId, name])
    if (name && name.trim() !== campus.name) {
      const existing = await prisma.campus.findUnique({
        where: {
          schoolId_name: {
            schoolId: campus.schoolId,
            name: data.name!,
          },
        },
      });

      if (existing) {
        return NextResponse.json(
          { error: "Un campus avec ce nom existe déjà pour cette école" },
          { status: 400 }
        );
      }
    }

    const updatedCampus = await prisma.campus.update({
      where: { id },
      data: { ...data, ...provenance(session.user.id, "MANUAL") },
    });

    revalidateContent();
    return NextResponse.json(updatedCampus);
  } catch (error) {
    console.error(`PUT /api/admin/campuses/${id} error:`, error);
    return NextResponse.json({ error: "Erreur serveur lors de la modification du campus" }, { status: 500 });
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
    const campus = await prisma.campus.findUnique({
      where: { id },
    });

    if (!campus) {
      return NextResponse.json({ error: "Campus introuvable" }, { status: 404 });
    }

    // Suppression en cascade (gérée par onDelete: Cascade dans le schéma Prisma)
    await prisma.campus.delete({
      where: { id },
    });

    revalidateContent();
    return NextResponse.json({ message: "Campus supprimé avec succès" });
  } catch (error) {
    console.error(`DELETE /api/admin/campuses/${id} error:`, error);
    return NextResponse.json({ error: "Erreur serveur lors de la suppression du campus" }, { status: 500 });
  }
}
