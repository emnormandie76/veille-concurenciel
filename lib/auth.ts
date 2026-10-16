/**
 * lib/auth.ts — Session et gardes d'accès
 *
 * Plan gestion-contenu, étape 1 :
 * - trois rôles, `USER`, `GESTIONNAIRE`, `ADMIN` (lib/roles.ts) ;
 * - trois gardes pour les routes, une par niveau : `guardSignedIn` (toute
 *   session), `guardManager` (gestionnaire ou admin), `guardAdmin`. Chaque
 *   route du back-office en attend une, et une seule
 *   (test/api/admin-guards.test.ts) ; l'ancienne garde unique, qui laissait
 *   passer toute session, n'existe plus (piège 1) ;
 * - `requirePage` pour les écrans serveur : connexion sans session, renvoi
 *   vers le site ou les écoles sans le rôle (piège 2) ;
 * - D1 : le rôle est **relu en base** à chaque appel. Celui du jeton JWT,
 *   copié à la connexion, peut dater de 8 h : il ne sert jamais à juger. Un
 *   compte supprimé n'a plus de session, même avec un jeton valide ;
 * - D20 (étape 2) : un compte qui n'est pas actif (invité après une remise en
 *   première connexion, désactivé) n'a plus de session non plus, et un jeton
 *   émis avant la dernière remise à zéro ne vaut plus : la version de session
 *   du jeton doit être celle du compte.
 *
 * Le proxy (proxy.ts) ne vérifie que l'existence d'une session : le rôle se
 * contrôle ici, côté serveur.
 */

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import { displayNameOf } from "@/lib/accounts";
import {
  LOGIN_PATH,
  REFUSAL_MESSAGES,
  UNAUTHENTICATED_MESSAGE,
  hasAccess,
  homeFor,
  isUserRole,
  type AccessLevel,
  type UserRole,
} from "@/lib/roles";

export type { AccessLevel, UserRole } from "@/lib/roles";

export interface AuthSession {
  user: {
    id: string;
    name: string;
    email: string | null;
    role: UserRole;
  };
}

// ──────────────────────────────────────────────
// Session
// ──────────────────────────────────────────────

/**
 * La session courante, avec le nom, l'adresse et le rôle **lus en base** (D1).
 *
 * Rend `null` sans session, sur un cookie illisible, quand le compte du jeton
 * n'existe plus, n'est pas actif, ou a été remis à zéro depuis l'émission du
 * jeton (D20). Un rôle que le code ne connaît pas (une base où la migration
 * des trois rôles n'est pas passée) ne donne que les droits d'un USER. Une
 * panne de la base, elle, remonte.
 */
export async function getSession(): Promise<AuthSession | null> {
  let session;
  try {
    session = await getServerSession(authOptions);
  } catch {
    // Cookie corrompu (JWEDecryptionFailed…) : pas de session.
    return null;
  }
  const user = session?.user as { id?: unknown; sessionVersion?: unknown } | undefined;
  const id = user?.id;
  if (!session?.user || typeof id !== "string" || id === "") return null;

  const account = await prisma.user.findUnique({
    where: { id },
    select: {
      username: true,
      email: true,
      display_name: true,
      role: true,
      status: true,
      session_version: true,
    },
  });
  if (!account) return null;

  // D20 : un invité (remis en première connexion) ou un compte désactivé n'a
  // plus de session ; un jeton d'avant la dernière remise à zéro, ou sans
  // version (émis avant l'étape 2), non plus.
  if (account.status !== "ACTIVE") return null;
  if (user?.sessionVersion !== account.session_version) return null;

  let role: UserRole = "USER";
  if (isUserRole(account.role)) {
    role = account.role;
  } else {
    console.warn(`[auth] rôle inconnu en base pour le compte ${id} : droits d'un USER`);
  }

  return {
    user: { id, name: displayNameOf(account), email: account.email, role },
  };
}

// ──────────────────────────────────────────────
// Gardes des API Routes (rendent une NextResponse)
// ──────────────────────────────────────────────

type GuardResult =
  | { session: AuthSession; error: null }
  | { session: null; error: NextResponse };

async function guard(level: AccessLevel): Promise<GuardResult> {
  const session = await getSession();
  if (!session) {
    return {
      session: null,
      error: NextResponse.json({ error: UNAUTHENTICATED_MESSAGE }, { status: 401 }),
    };
  }
  if (level !== "signedIn" && !hasAccess(session.user.role, level)) {
    return {
      session: null,
      error: NextResponse.json({ error: REFUSAL_MESSAGES[level] }, { status: 403 }),
    };
  }
  return { session, error: null };
}

/**
 * Toute session : 401 sans session. À réserver à ce que chacun fait pour
 * lui-même (changer son mot de passe).
 *
 * @example
 * const { session, error } = await guardSignedIn();
 * if (error) return error;
 */
export async function guardSignedIn(): Promise<GuardResult> {
  return guard("signedIn");
}

/**
 * Gestionnaire ou admin : 401 sans session, 403 pour un USER. La garde de la
 * lecture et de l'écriture du contenu dans le back-office.
 */
export async function guardManager(): Promise<GuardResult> {
  return guard("manager");
}

/**
 * Admin seulement : 401 sans session, 403 sinon. L'IA (backend, historique,
 * inbox) et les comptes.
 */
export async function guardAdmin(): Promise<GuardResult> {
  return guard("admin");
}

// ──────────────────────────────────────────────
// Écrans serveur (layouts et pages)
// ──────────────────────────────────────────────

/**
 * Rend la session si son rôle atteint `level` ; sinon redirige : vers la
 * connexion sans session, vers le site pour un USER, vers les écoles pour un
 * gestionnaire hors de l'IA.
 */
export async function requirePage(level: AccessLevel): Promise<AuthSession> {
  const session = await getSession();
  if (!session) redirect(LOGIN_PATH);
  if (!hasAccess(session.user.role, level)) redirect(homeFor(session.user.role));
  return session;
}
