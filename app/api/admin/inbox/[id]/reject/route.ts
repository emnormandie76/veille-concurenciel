/**
 * app/api/admin/inbox/[id]/reject/route.ts — PUT /api/admin/inbox/[id]/reject (Étape 3.1)
 *
 * Rejette un ticket ContributionInbox.
 * - Passe le status à "Rejected"
 * - Aucune donnée ne rejoint les tables de production (Règle 5)
 *
 * Référence : task.md §3.1, architecture.md §3.4
 */

import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const ticket = await prisma.contributionInbox.findUnique({ where: { id } });

    if (!ticket) {
      return NextResponse.json({ error: "Ticket introuvable" }, { status: 404 });
    }

    if (ticket.status === "Validated") {
      return NextResponse.json(
        { error: "Impossible de rejeter un ticket déjà validé" },
        { status: 400 }
      );
    }

    if (ticket.status === "Rejected") {
      return NextResponse.json(
        { error: "Ticket déjà rejeté" },
        { status: 400 }
      );
    }

    const updated = await prisma.contributionInbox.update({
      where: { id },
      data: { status: "Rejected" },
    });

    return NextResponse.json({
      message: "Ticket rejeté avec succès",
      ticket: updated,
    });
  } catch (error) {
    console.error(`PUT /api/admin/inbox/${id}/reject error:`, error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
