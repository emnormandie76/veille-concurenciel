/**
 * GET /api/admin/account/back-office — Le lien « Back-office » de la barre du site (D104)
 *
 * Plan gestion-contenu, étape 10 : l'accueil, les deux fiches et /api-docs
 * ne lisent pas la session (ils étaient alors en cache) ; leur barre demande ici si le compte
 * de la session a accès au back-office, pour ne montrer le lien qu'à un
 * gestionnaire ou un admin (components/layout/BackOfficeLink.tsx). Le rôle
 * est celui de la base, relu par la garde (D1), jamais celui du jeton.
 *
 * La route ne prend aucun identifiant et ne rend que oui ou non : ni
 * l'identifiant, ni le nom, ni l'adresse, ni le rôle. Jamais en cache : un
 * changement de rôle se voit à la page suivante. Le lien n'est qu'une
 * commodité : le layout /admin contrôle l'accès (`requirePage("manager")`).
 *
 * Garde : `guardSignedIn` (test/helpers/access-policy.ts, SIGNED_IN).
 */

import { NextResponse } from "next/server";
import { guardSignedIn } from "@/lib/auth";
import { hasAccess } from "@/lib/roles";

export async function GET() {
  const { session, error } = await guardSignedIn();
  if (error) return error;

  return NextResponse.json(
    { backOffice: hasAccess(session.user.role, "manager") },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
