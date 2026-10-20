/**
 * DELETE /api/admin/users/[id] — Retirer un invité de la liste (G5)
 *
 * Plan gestion-contenu, étape 2 : tant que la personne ne s'est pas connectée,
 * l'admin peut retirer son adresse ; elle ne peut plus alors ni faire sa
 * première connexion ni se connecter. Un compte actif ou désactivé ne se
 * supprime plus : il se désactive (D21), pour que son nom reste dans
 * l'historique des modifications (étape 5).
 *
 * Un invité peut avoir servi : remis en première connexion (D4), il est
 * redevenu invité. S'il a modifié une donnée, la base refuse sa suppression
 * (clé `ON DELETE RESTRICT` de `updated_by_id`, D24), comme s'il a envoyé ou
 * traité un signalement (clés de `ContentReport`, D38) ou lancé une recherche
 * IA (clé de `ResearchLaunch`, D42) : la route répond 409, et le compte se
 * désactive au lieu d'être retiré.
 *
 * On ne se retire pas soi-même. Garde : `guardAdmin`.
 */

import { NextResponse } from "next/server";
import { guardAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await guardAdmin();
  if (error) return error;

  const { id } = await params;

  if (session.user.id === id) {
    return NextResponse.json(
      { error: "Vous ne pouvez pas retirer votre propre compte." },
      { status: 400 }
    );
  }

  try {
    const target = await prisma.user.findUnique({ where: { id }, select: { status: true } });
    if (!target) {
      return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });
    }
    if (target.status !== "INVITED") {
      return NextResponse.json(
        { error: "Ce compte a déjà servi : désactivez-le au lieu de le retirer, son nom reste ainsi dans l'historique." },
        { status: 409 }
      );
    }

    // L'état est revérifié par l'écriture : un invité qui fait sa première
    // connexion à cet instant n'est pas supprimé.
    const { count } = await prisma.user.deleteMany({ where: { id, status: "INVITED" } });
    if (count === 0) {
      return NextResponse.json(
        { error: "Ce compte vient de changer d'état. Rechargez la liste." },
        { status: 409 }
      );
    }

    console.log(`[audit] invité retiré de la liste : user=${id} par=${session.user.id}`);
    return NextResponse.json({ message: "Adresse retirée de la liste." });
  } catch (err) {
    // Clé RESTRICT des auteurs du contenu (D24), des signalements, envoyés
    // ou traités (D38), ou des lancements de l'IA (D42).
    if ((err as { code?: unknown })?.code === "P2003") {
      return NextResponse.json(
        { error: "Ce compte a déjà modifié des données, envoyé ou traité un signalement, ou lancé une recherche IA : désactivez-le au lieu de le retirer, son nom reste ainsi dans l'historique." },
        { status: 409 }
      );
    }
    console.error(`DELETE /api/admin/users/${id} error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors du retrait de l'adresse." }, { status: 500 });
  }
}
