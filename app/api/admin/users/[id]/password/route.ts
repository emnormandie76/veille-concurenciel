/**
 * PATCH /api/admin/users/[id]/password — Changement de mot de passe
 *
 * Deux usages, un seul point d'entrée :
 *  - Sur son propre compte : le mot de passe courant est exigé et vérifié.
 *  - Sur le compte d'un tiers : réservé au rôle ADMIN (réinitialisation).
 *
 * Garde : toute session (`guardSignedIn`). Un USER ou un GESTIONNAIRE ne peut
 * agir que sur lui-même. Aucun appelant ne peut modifier un compte sans prouver
 * soit la possession du mot de passe courant, soit le rôle ADMIN.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { guardSignedIn } from "@/lib/auth";
import { validatePassword } from "@/lib/password";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await guardSignedIn();
  if (guard.error) return guard.error;
  const session = guard.session;

  const { id } = await params;
  const isSelf = session.user.id === id;
  const isAdmin = session.user.role === "ADMIN";

  if (!isSelf && !isAdmin) {
    return NextResponse.json(
      { error: "Accès interdit : seul un ADMIN peut réinitialiser le mot de passe d'un tiers." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête JSON invalide" }, { status: 400 });
  }

  const { currentPassword, newPassword } = (body ?? {}) as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };

  const policyError = validatePassword(newPassword);
  if (policyError) {
    return NextResponse.json({ error: policyError }, { status: 400 });
  }
  // Après validatePassword, newPassword est nécessairement une chaîne conforme.
  const nextPassword = newPassword as string;

  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
    }

    // Changement de son propre mot de passe : preuve de possession exigée.
    if (isSelf) {
      if (typeof currentPassword !== "string" || currentPassword.length === 0) {
        return NextResponse.json(
          { error: "Le mot de passe actuel est requis." },
          { status: 400 }
        );
      }
      const isValid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isValid) {
        return NextResponse.json(
          { error: "Mot de passe actuel incorrect." },
          { status: 403 }
        );
      }
    }

    // Refuser un « changement » qui n'en est pas un.
    const isSameAsBefore = await bcrypt.compare(nextPassword, user.password_hash);
    if (isSameAsBefore) {
      return NextResponse.json(
        { error: "Le nouveau mot de passe doit être différent de l'actuel." },
        { status: 400 }
      );
    }

    const password_hash = await bcrypt.hash(nextPassword, 12);
    await prisma.user.update({
      where: { id },
      data: { password_hash },
    });

    console.log(
      `[audit] mot de passe modifié pour user=${id} par=${session.user.id} (self=${isSelf})`
    );

    return NextResponse.json({ message: "Mot de passe mis à jour avec succès." });
  } catch (error) {
    console.error(`PATCH /api/admin/users/${id}/password error:`, error);
    return NextResponse.json(
      { error: "Erreur serveur lors du changement de mot de passe" },
      { status: 500 }
    );
  }
}
