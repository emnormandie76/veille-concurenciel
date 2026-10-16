/**
 * lib/sign-in.ts — Les identifiants de la connexion, et ce qui part dans le jeton
 *
 * Plan gestion-contenu, étape 2 : la connexion se fait par l'adresse de
 * travail et le mot de passe (G5).
 * - D3 : l'ancien identifiant (`username`) ne vaut que pour un compte qui n'a
 *   pas encore d'adresse ; dès que l'admin la renseigne, il cesse de servir ;
 * - seul un compte actif se connecte : un invité n'a pas encore de mot de
 *   passe, un compte désactivé (D21) n'en a plus ;
 * - D20 : la version de session du compte est copiée dans le jeton ;
 *   lib/auth.ts la compare à celle de la base à chaque requête.
 *
 * La route NextAuth (app/api/auth/[...nextauth]/route.ts) ne fait que brancher
 * `verifyCredentials` et `authCallbacks` : la logique se teste ici, sans
 * charger NextAuth (test/sign-in.test.ts).
 */

import bcrypt from "bcryptjs";
import type { Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { displayNameOf, normalizeEmail } from "@/lib/accounts";
import { isUserRole, type UserRole } from "@/lib/roles";

/** Ce que NextAuth reçoit d'une connexion réussie. */
export interface SignedInAccount {
  id: string;
  name: string;
  email: string | null;
  role: UserRole;
  sessionVersion: number;
}

/**
 * Vérifie un identifiant (l'adresse, ou l'ancien identifiant d'un compte sans
 * adresse) et un mot de passe. Rend le compte, ou `null` sans dire pourquoi.
 */
export async function verifyCredentials(login: unknown, password: unknown): Promise<SignedInAccount | null> {
  if (typeof login !== "string" || typeof password !== "string") return null;
  const identifier = login.trim();
  if (identifier === "" || password === "") return null;

  const byEmail = identifier.includes("@");
  const account = byEmail
    ? await prisma.user.findUnique({ where: { email: normalizeEmail(identifier) } })
    : await prisma.user.findUnique({ where: { username: identifier } });
  if (!account) return null;

  // D3 : l'ancien identifiant cesse de servir dès que le compte a une adresse.
  if (!byEmail && account.email !== null) return null;
  // Un invité n'a pas encore de mot de passe ; un compte désactivé n'en a plus.
  if (account.status !== "ACTIVE" || !account.password_hash) return null;
  if (!(await bcrypt.compare(password, account.password_hash))) return null;

  return {
    id: account.id,
    name: displayNameOf(account),
    email: account.email,
    role: isUserRole(account.role) ? account.role : "USER",
    sessionVersion: account.session_version,
  };
}

/**
 * Les rappels NextAuth. Le rôle copié dans le jeton est indicatif (D1) ; la
 * version de session, elle, est comparée à la base à chaque requête (D20).
 */
export const authCallbacks = {
  async jwt({ token, user }: { token: JWT; user?: User }): Promise<JWT> {
    if (user) {
      const account = user as unknown as SignedInAccount;
      return { ...token, id: account.id, role: account.role, sessionVersion: account.sessionVersion };
    }
    return token;
  },
  async session({ session, token }: { session: Session; token: JWT }): Promise<Session> {
    if (session.user) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.sessionVersion = token.sessionVersion;
    }
    return session;
  },
};
