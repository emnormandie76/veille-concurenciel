/**
 * PATCH /api/admin/account/password — Changer son mot de passe
 *
 * Plan gestion-contenu, étape 2 : chacun, USER compris, change le sien sur la
 * page « Mon compte », en prouvant qu'il connaît l'actuel. La route ne prend
 * aucun identifiant : elle vise le compte de la session, et lui seul.
 *
 * Personne ne fixe plus le mot de passe d'un tiers (D4) : un oubli se règle par
 * la remise en première connexion (/api/admin/users/[id]/reset). Elle remplace
 * l'ancienne route `users/[id]/password`, qui le permettait à l'admin.
 *
 * Garde : `guardSignedIn` (test/helpers/access-policy.ts, SIGNED_IN).
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { guardSignedIn } from "@/lib/auth";
import { validatePassword } from "@/lib/password";
import { invalidBody } from "@/lib/account-admin";
import { readJsonObject } from "@/lib/request-body";

export async function PATCH(request: Request) {
  const { session, error } = await guardSignedIn();
  if (error) return error;
  const id = session.user.id;

  const body = await readJsonObject(request);
  if (!body) return invalidBody();
  const { currentPassword, newPassword } = body;

  const policyError = validatePassword(newPassword);
  if (policyError) {
    return NextResponse.json({ error: policyError }, { status: 400 });
  }
  // Après validatePassword, newPassword est nécessairement une chaîne conforme.
  const nextPassword = newPassword as string;

  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    return NextResponse.json({ error: "Le mot de passe actuel est requis." }, { status: 400 });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id }, select: { password_hash: true } });
    // Une session vaut un compte actif (lib/auth.ts), donc un mot de passe.
    if (!user?.password_hash) {
      return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });
    }

    // Preuve de possession.
    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      return NextResponse.json({ error: "Mot de passe actuel incorrect." }, { status: 403 });
    }

    // Refuser un « changement » qui n'en est pas un.
    if (await bcrypt.compare(nextPassword, user.password_hash)) {
      return NextResponse.json(
        { error: "Le nouveau mot de passe doit être différent de l'actuel." },
        { status: 400 }
      );
    }

    const password_hash = await bcrypt.hash(nextPassword, 12);
    await prisma.user.update({ where: { id }, data: { password_hash } });

    console.log(`[audit] mot de passe modifié par son titulaire : user=${id}`);
    return NextResponse.json({ message: "Mot de passe mis à jour." });
  } catch (err) {
    console.error("PATCH /api/admin/account/password error:", err);
    return NextResponse.json({ error: "Erreur serveur lors du changement de mot de passe." }, { status: 500 });
  }
}
