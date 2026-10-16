/**
 * lib/account-admin.ts — Ce que l'admin change sur un compte, sans jamais laisser zéro admin
 *
 * Plan gestion-contenu, étape 2. Les routes de /api/admin/users/[id]/*
 * (rôle, remise en première connexion, désactivation, adresse) passent par
 * `changeAccount` :
 * - le compte visé est relu, et la route décide sur cet état (`plan`) ;
 * - **aucune opération ne laisse zéro admin actif** (règle retenue le
 *   16 octobre) : si le compte est un admin actif et ne le sera plus, il doit
 *   en rester un autre. Les admins encore invités ne comptent pas ;
 * - le tout dans une transaction **sérialisable** : deux admins qui se
 *   rétrogradent l'un l'autre au même moment voient chacun l'autre encore
 *   admin ; Postgres refuse alors l'une des deux transactions (conflit de
 *   sérialisation, P2034 chez Prisma), qui répond 409 « Réessayez ».
 *
 * La règle se juge sur la base, pas sur le rôle de l'appelant : un admin
 * rétrogradé entre sa garde et son écriture ne peut pas retirer le dernier.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { AccountStatus } from "@/lib/accounts";
import type { UserRole } from "@/lib/roles";

/** Ce que l'écran des comptes lit d'un compte : jamais l'empreinte ni la version de session. */
export const ACCOUNT_SELECT = {
  id: true,
  email: true,
  username: true,
  display_name: true,
  role: true,
  status: true,
  first_login_at: true,
  createdAt: true,
} as const;

export interface AccountView {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  role: string;
  status: string;
  first_login_at: Date | null;
  createdAt: Date;
}

/** Ce qu'une route des comptes peut écrire. */
export interface AccountChange {
  role?: UserRole;
  status?: AccountStatus;
  email?: string;
  password_hash?: null;
  first_login_at?: null;
  session_version?: { increment: number };
}

export type AccountPlan = { data: AccountChange } | { status: number; error: string };

export const LAST_ADMIN_MESSAGE =
  "Opération refusée : il doit rester au moins un administrateur actif. Nommez d'abord un autre administrateur.";
export const CONCURRENT_CHANGE_MESSAGE =
  "Une autre modification des comptes a eu lieu en même temps. Rechargez la liste et réessayez.";
export const EMAIL_TAKEN_MESSAGE = "Cette adresse est déjà utilisée par un autre compte.";

const isActiveAdmin = (account: { role: string; status: string }) =>
  account.role === "ADMIN" && account.status === "ACTIVE";

/** Le code d'erreur Prisma, s'il y en a un. */
export function prismaCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

type Outcome = { account: AccountView } | { status: number; error: string };

/**
 * Relit le compte `id`, laisse `plan` décider sur son état, applique le
 * changement si aucun admin actif ne manque ensuite, et rend la réponse.
 */
export async function changeAccount(
  id: string,
  plan: (target: AccountView) => AccountPlan,
  label: string
): Promise<NextResponse> {
  let outcome: Outcome;
  try {
    outcome = await prisma.$transaction(
      async (tx): Promise<Outcome> => {
        const target = await tx.user.findUnique({ where: { id }, select: ACCOUNT_SELECT });
        if (!target) return { status: 404, error: "Compte introuvable." };

        const decision = plan(target);
        if ("error" in decision) return decision;
        const { data } = decision;

        const after = { role: data.role ?? target.role, status: data.status ?? target.status };
        if (isActiveAdmin(target) && !isActiveAdmin(after)) {
          const others = await tx.user.count({
            where: { role: "ADMIN", status: "ACTIVE", id: { not: id } },
          });
          if (others === 0) return { status: 409, error: LAST_ADMIN_MESSAGE };
        }

        const account = await tx.user.update({ where: { id }, data, select: ACCOUNT_SELECT });
        return { account };
      },
      { isolationLevel: "Serializable" }
    );
  } catch (error) {
    const code = prismaCode(error);
    if (code === "P2034") {
      return NextResponse.json({ error: CONCURRENT_CHANGE_MESSAGE }, { status: 409 });
    }
    if (code === "P2002") {
      return NextResponse.json({ error: EMAIL_TAKEN_MESSAGE }, { status: 409 });
    }
    console.error(`${label} error:`, error);
    return NextResponse.json({ error: "Erreur serveur lors de la modification du compte." }, { status: 500 });
  }

  if ("error" in outcome) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }
  return NextResponse.json(outcome.account);
}

/** La réponse à un corps absent ou illisible (lib/request-body.ts, `readJsonObject`). */
export function invalidBody(): NextResponse {
  return NextResponse.json({ error: "Corps de requête JSON invalide." }, { status: 400 });
}
