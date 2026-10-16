/**
 * PATCH /api/admin/users/[id]/role — Changer le rôle d'un compte
 *
 * Plan gestion-contenu, étape 2 (G4) : l'admin donne à chacun son rôle,
 * `USER`, `GESTIONNAIRE` ou `ADMIN`, invités compris (avant leur première
 * connexion) ; il peut nommer un autre admin. Un admin peut se rétrograder
 * lui-même, à condition qu'il reste un autre admin actif : aucune opération ne
 * laisse zéro admin (lib/account-admin.ts, transaction sérialisable).
 *
 * Le rôle est relu en base à chaque requête (D1) : le changement vaut dès la
 * requête suivante de la personne. Garde : `guardAdmin`.
 */

import { NextResponse } from "next/server";
import { guardAdmin } from "@/lib/auth";
import { isUserRole } from "@/lib/roles";
import { changeAccount, invalidBody } from "@/lib/account-admin";
import { readJsonObject } from "@/lib/request-body";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await guardAdmin();
  if (error) return error;

  const { id } = await params;
  const body = await readJsonObject(request);
  if (!body) return invalidBody();

  const role = body.role;
  if (!isUserRole(role)) {
    return NextResponse.json({ error: "Rôle inconnu : USER, GESTIONNAIRE ou ADMIN." }, { status: 400 });
  }

  const response = await changeAccount(id, () => ({ data: { role } }), `PATCH /api/admin/users/${id}/role`);
  if (response.ok) console.log(`[audit] rôle ${role} donné à user=${id} par=${session.user.id}`);
  return response;
}
