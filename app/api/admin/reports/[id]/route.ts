/**
 * PATCH /api/admin/reports/[id] — Traiter ou rejeter un signalement
 *
 * Plan gestion-contenu, étape 6 (D31) : depuis la vue `/admin/reports`, un
 * gestionnaire ferme un signalement en attente, avec une réponse facultative
 * que l'auteur lira sur « Mon compte » (D36). Celui qui traite est le compte de
 * la session, jamais une valeur du corps ; la date est celle du serveur.
 *
 * Un signalement fermé ne change plus : l'écriture ne vise qu'un signalement
 * encore en attente, et deux gestionnaires qui le ferment en même temps ne
 * l'écrivent qu'une fois (l'autre reçoit 409).
 *
 * Fermer un signalement ne date aucune donnée (D32) : la correction se fait
 * dans l'onglet de gestion, où elle reste `MANUAL`.
 *
 * Garde : `guardManager` (niveau par défaut de test/helpers/access-policy.ts).
 */

import { NextResponse } from "next/server";
import { guardManager } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { invalidBody } from "@/lib/account-admin";
import { readJsonObject } from "@/lib/request-body";
import { readDecision } from "@/lib/content-reports";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await guardManager();
  if (error) return error;

  const { id } = await params;

  const body = await readJsonObject(request);
  if (!body) return invalidBody();

  const read = readDecision(body);
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: 400 });
  const { status, response } = read.value;

  try {
    const { count } = await prisma.contentReport.updateMany({
      where: { id, status: "OPEN" },
      data: { status, response, handled_by_id: session.user.id, handled_at: new Date() },
    });

    if (count === 0) {
      const existing = await prisma.contentReport.findUnique({ where: { id }, select: { status: true } });
      if (!existing) {
        return NextResponse.json({ error: "Signalement introuvable." }, { status: 404 });
      }
      return NextResponse.json(
        { error: "Ce signalement a déjà été traité ou rejeté. Rechargez la liste." },
        { status: 409 }
      );
    }

    return NextResponse.json({ message: status === "RESOLVED" ? "Signalement traité." : "Signalement rejeté." });
  } catch (err) {
    console.error(`PATCH /api/admin/reports/${id} error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
