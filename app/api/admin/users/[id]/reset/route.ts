/**
 * POST /api/admin/users/[id]/reset — Remettre un compte en première connexion (D4)
 *
 * Plan gestion-contenu, étape 2 : sans envoi d'e-mail, un mot de passe oublié
 * se règle ainsi. Le mot de passe est effacé, le compte redevient invité, et
 * la personne en choisit un nouveau à sa première connexion, sur le même
 * modèle de confiance que G5. Son rôle, son nom et son adresse sont gardés.
 * Les sessions ouvertes sont coupées : la version de session augmente (D20).
 *
 * C'est aussi ainsi qu'un compte désactivé se réactive (D21). L'admin ne fixe
 * jamais le mot de passe d'un tiers.
 *
 * Refus : soi-même (changez votre mot de passe sur « Mon compte ») ; un compte
 * sans adresse (D3 : il ne pourrait pas refaire sa première connexion) ; un
 * invité, qui y est déjà ; le dernier admin actif (lib/account-admin.ts).
 * Garde : `guardAdmin`.
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
    return NextResponse.json(
      { error: "Vous ne pouvez pas vous remettre vous-même en première connexion : changez votre mot de passe sur « Mon compte »." },
      { status: 400 }
    );
  }

  const response = await changeAccount(
    id,
    (target) => {
      if (target.email === null) {
        return {
          status: 400,
          error: "Renseignez d'abord l'adresse e-mail de ce compte : sans elle, la personne ne pourrait pas refaire sa première connexion.",
        };
      }
      if (target.status === "INVITED") {
        return { status: 409, error: "Ce compte attend déjà sa première connexion." };
      }
      return {
        data: {
          status: "INVITED",
          password_hash: null,
          first_login_at: null,
          session_version: { increment: 1 },
        },
      };
    },
    `POST /api/admin/users/${id}/reset`
  );
  if (response.ok) console.log(`[audit] compte remis en première connexion : user=${id} par=${session.user.id}`);
  return response;
}
