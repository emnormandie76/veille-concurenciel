import { guardManager } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { revalidateContent } from "@/lib/content-cache";
import { AUTHOR_SELECT, forManager, provenance } from "@/lib/provenance";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardManager();
  if (error) return error;

  const { id } = await params;

  try {
    const school = await prisma.school.findUnique({
      where: { id },
      include: { updatedBy: AUTHOR_SELECT },
    });

    if (!school) {
      return NextResponse.json({ error: "École introuvable" }, { status: 404 });
    }

    // « Modifié par … le … » de chaque ligne : le nom et la date (étape 5, D29).
    return NextResponse.json(forManager(school));
  } catch (error) {
    console.error(`GET /api/admin/schools/${id} error:`, error);
    return NextResponse.json({ error: "Erreur serveur lors de la récupération" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await guardManager();
  if (error) return error;

  const { id } = await params;

  try {
    const body = await request.json();
    const { name, official_domain, status } = body;

    if (!name && !official_domain && !status) {
      return NextResponse.json(
        { error: "Au moins un champ (nom, domaine officiel ou statut) doit être fourni" },
        { status: 400 }
      );
    }

    // Un nom ou un domaine fourni ne peut pas être vide une fois nettoyé.
    // Jusqu'au 14 octobre 2026, un nom fait d'espaces passait et une chaîne
    // vide était écrite (décision 12, plan backend-local).
    const isBlank = (value: unknown) => typeof value !== "string" || value.trim() === "";
    if ((name !== undefined && isBlank(name)) || (official_domain !== undefined && isBlank(official_domain))) {
      return NextResponse.json(
        { error: "Le nom et le domaine officiel ne peuvent pas être vides" },
        { status: 400 }
      );
    }

    if (status && !["ACTIVE", "INACTIVE", "DRAFT"].includes(status)) {
      return NextResponse.json(
        { error: "Le statut doit être ACTIVE, INACTIVE ou DRAFT" },
        { status: 400 }
      );
    }

    // Récupérer l'école existante
    const school = await prisma.school.findUnique({
      where: { id },
    });

    if (!school) {
      return NextResponse.json({ error: "École introuvable" }, { status: 404 });
    }

    const data: Record<string, any> = {};
    if (name) data.name = name.trim();
    if (official_domain) data.official_domain = official_domain.trim().toLowerCase();
    if (status) data.status = status;

    // Vérifier l'unicité si le nom ou le domaine change
    if (name || official_domain) {
      const existing = await prisma.school.findFirst({
        where: {
          id: { not: id },
          OR: [
            name ? { name: data.name } : {},
            official_domain ? { official_domain: data.official_domain } : {}
          ].filter(cond => Object.keys(cond).length > 0)
        }
      });

      if (existing) {
        return NextResponse.json(
          { error: "Une autre école possède déjà ce nom ou ce domaine officiel" },
          { status: 400 }
        );
      }
    }

    const updatedSchool = await prisma.school.update({
      where: { id },
      data: { ...data, ...provenance(session.user.id, "MANUAL") },
    });

    revalidateContent();
    return NextResponse.json(updatedSchool);
  } catch (error) {
    console.error(`PUT /api/admin/schools/${id} error:`, error);
    return NextResponse.json({ error: "Erreur serveur lors de la modification" }, { status: 500 });
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
    const { searchParams } = new URL(request.url);
    const confirmName = searchParams.get("confirmName");

    // Trouver l'école
    const school = await prisma.school.findUnique({
      where: { id },
    });

    if (!school) {
      return NextResponse.json({ error: "École introuvable" }, { status: 404 });
    }

    // Double confirmation
    if (!confirmName || confirmName.trim() !== school.name) {
      return NextResponse.json(
        { error: `Confirmation échouée. Vous devez entrer le nom exact de l'école: "${school.name}".` },
        { status: 400 }
      );
    }

    // Suppression en cascade (gérée au niveau Prisma/DB onDelete: Cascade)
    await prisma.school.delete({
      where: { id },
    });

    revalidateContent();
    return NextResponse.json({ message: "École supprimée avec succès" });
  } catch (error) {
    console.error(`DELETE /api/admin/schools/${id} error:`, error);
    return NextResponse.json({ error: "Erreur serveur lors de la suppression" }, { status: 500 });
  }
}
