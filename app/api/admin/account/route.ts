/**
 * PATCH /api/admin/account — Changer son nom affiché (D6)
 *
 * Plan gestion-contenu, étape 2 : chacun, USER compris, choisit le nom qui
 * signera ses modifications (« modifié par », étape 5), sur la page « Mon
 * compte ». La route ne prend aucun identifiant : elle vise le compte de la
 * session, et lui seul.
 *
 * Garde : `guardSignedIn` (test/helpers/access-policy.ts, SIGNED_IN).
 */

import { NextResponse } from "next/server";
import { guardSignedIn } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateDisplayName } from "@/lib/accounts";
import { invalidBody } from "@/lib/account-admin";
import { readJsonObject } from "@/lib/request-body";

export async function PATCH(request: Request) {
  const { session, error } = await guardSignedIn();
  if (error) return error;

  const body = await readJsonObject(request);
  if (!body) return invalidBody();

  const checked = validateDisplayName(body.displayName);
  if (checked.error !== null) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  try {
    const account = await prisma.user.update({
      where: { id: session.user.id },
      data: { display_name: checked.name },
      select: { display_name: true },
    });
    return NextResponse.json({ displayName: account.display_name });
  } catch (err) {
    console.error("PATCH /api/admin/account error:", err);
    return NextResponse.json({ error: "Erreur serveur lors du changement de nom." }, { status: 500 });
  }
}
