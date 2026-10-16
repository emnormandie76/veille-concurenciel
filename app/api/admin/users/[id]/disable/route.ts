/**
 * POST /api/admin/users/[id]/disable — Désactiver un compte (D21)
 *
 * Plan gestion-contenu, étape 2 : un collègue qui part n'est pas supprimé. Son
 * compte ne peut plus se connecter (mot de passe effacé), ses sessions
 * ouvertes sont coupées (version de session augmentée, D20), mais son nom
 * reste pour l'historique des modifications (étape 5) et son adresse reste
 * réservée. Il se réactive par la remise en première connexion (D4).
 *
 * Refus : soi-même ; un invité, qui se retire de la liste au lieu d'être
 * désactivé ; un compte déjà désactivé ; le dernier admin actif
 * (lib/account-admin.ts). Garde : `guardAdmin`.
 */

import { NextResponse } from "next/server";
import { guardAdmin } from "@/lib/auth";
import { changeAccount } from "@/lib/account-admin";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await guardAdmin();
  if (error) return error;

  const { id } = await params;
  if (session.user.id === id) {
    return NextResponse.json({ error: "Vous ne pouvez pas désactiver votre propre compte." }, { status: 400 });
  }

  const response = await changeAccount(
    id,
    (target) => {
      if (target.status === "INVITED") {
        return { status: 409, error: "Un invité ne se désactive pas : retirez-le de la liste." };
      }
      if (target.status === "DISABLED") {
        return { status: 409, error: "Ce compte est déjà désactivé." };
      }
      return { data: { status: "DISABLED", password_hash: null, session_version: { increment: 1 } } };
    },
    `POST /api/admin/users/${id}/disable`
  );
  if (response.ok) console.log(`[audit] compte désactivé : user=${id} par=${session.user.id}`);
  return response;
}
