/**
 * PATCH /api/admin/users/[id]/email — L'adresse d'un compte d'avant la liste blanche (D3)
 *
 * Plan gestion-contenu, étape 2 : les comptes créés avant la liste blanche
 * n'ont qu'un identifiant. L'admin renseigne leur adresse de travail (la
 * sienne comprise) ; dès qu'elle est posée, l'ancien identifiant cesse de
 * servir à la connexion (lib/sign-in.ts). Rien d'autre ne change : ni le mot
 * de passe, ni le rôle, ni les sessions.
 *
 * Seul un compte sans adresse en reçoit une : une adresse posée ne se change
 * pas ici. Domaine imposé (D5) ; une adresse déjà prise → 409.
 * Garde : `guardAdmin`.
 */

import { NextResponse } from "next/server";
import { guardAdmin } from "@/lib/auth";
import { validateWorkEmail } from "@/lib/accounts";
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

  const checked = validateWorkEmail(body.email);
  if (checked.error !== null) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }
  const email = checked.email;

  const response = await changeAccount(
    id,
    (target) =>
      target.email !== null
        ? { status: 409, error: "Ce compte a déjà une adresse e-mail." }
        : { data: { email } },
    `PATCH /api/admin/users/${id}/email`
  );
  if (response.ok) console.log(`[audit] adresse renseignée : user=${id} par=${session.user.id}`);
  return response;
}
