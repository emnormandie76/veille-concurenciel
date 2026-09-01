import { guardAdmin } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await guardAdmin();
  if (guard.error) return guard.error;
  const session = guard.session;

  const { id } = await params;

  try {
    // Empêcher l'admin de se supprimer lui-même
    if (session.user.id === id) {
      return NextResponse.json(
        { error: "Sécurité : Vous ne pouvez pas supprimer votre propre compte connecté." },
        { status: 400 }
      );
    }

    const userToFind = await prisma.user.findUnique({
      where: { id },
    });

    if (!userToFind) {
      return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
    }

    await prisma.user.delete({
      where: { id },
    });

    return NextResponse.json({ message: "Utilisateur supprimé avec succès" });
  } catch (error) {
    console.error(`DELETE /api/admin/users/${id} error:`, error);
    return NextResponse.json({ error: "Erreur serveur lors de la suppression de l'utilisateur" }, { status: 500 });
  }
}
