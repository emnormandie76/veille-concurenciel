/**
 * app/api/admin/inbox/[id]/route.ts — GET /api/admin/inbox/[id] (Étape 3.1)
 *
 * Détail complet d'un ticket ContributionInbox.
 * Inclut les relations école, campus, programme.
 *
 * Référence : task.md §3.1, architecture.md §3.4
 */

import { guardAdmin } from "@/lib/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardAdmin();
  if (error) return error;

  const { id } = await params;

  try {
    const ticket = await prisma.contributionInbox.findUnique({
      where: { id },
    });

    if (!ticket) {
      return NextResponse.json({ error: "Ticket introuvable" }, { status: 404 });
    }

    return NextResponse.json(ticket);
  } catch (error) {
    console.error(`GET /api/admin/inbox/${id} error:`, error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
