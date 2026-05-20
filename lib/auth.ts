/**
 * lib/auth.ts — Helpers de session NextAuth (Étape 1.3)
 *
 * Fournit des utilitaires réutilisables pour :
 * - Récupérer la session courante (Server Components & API Routes)
 * - Vérifier les rôles (ADMIN uniquement)
 * - Protéger les API Routes avec une réponse 401/403 standardisée
 *
 * Référence : task.md §1.3, architecture.md §3.6, §7.4
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { NextResponse } from "next/server";

// ──────────────────────────────────────────────
// Types augmentés
// ──────────────────────────────────────────────

export type UserRole = "ADMIN" | "MODERATOR";

export interface AuthSession {
  user: {
    id: string;
    name: string;
    email: string | null;
    role: UserRole;
  };
}

// ──────────────────────────────────────────────
// Récupération de session
// ──────────────────────────────────────────────

/**
 * Récupère la session NextAuth courante.
 * À utiliser dans les Server Components et API Routes.
 */
export async function getSession(): Promise<AuthSession | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return session as AuthSession;
}

// ──────────────────────────────────────────────
// Vérifications de rôle
// ──────────────────────────────────────────────

/**
 * Vérifie qu'une session est valide (ADMIN ou MODERATOR).
 * Retourne la session ou null.
 */
export async function requireAuth(): Promise<AuthSession | null> {
  return getSession();
}

/**
 * Vérifie qu'une session est valide ET que le rôle est ADMIN.
 * Retourne la session ou null.
 */
export async function requireAdmin(): Promise<AuthSession | null> {
  const session = await getSession();
  if (!session) return null;
  if (session.user.role !== "ADMIN") return null;
  return session;
}

// ──────────────────────────────────────────────
// Guards pour les API Routes (retournent NextResponse)
// ──────────────────────────────────────────────

/**
 * Guard API : retourne 401 si pas de session, sinon la session.
 * Utiliser dans les API Routes protégées.
 *
 * @example
 * const { session, error } = await guardAuth();
 * if (error) return error;
 */
export async function guardAuth(): Promise<
  { session: AuthSession; error: null } | { session: null; error: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return {
      session: null,
      error: NextResponse.json(
        { error: "Non authentifié. Veuillez vous connecter." },
        { status: 401 }
      ),
    };
  }
  return { session, error: null };
}

/**
 * Guard API : retourne 401 si pas de session, 403 si pas ADMIN.
 * Utiliser dans les API Routes réservées aux admins.
 *
 * @example
 * const { session, error } = await guardAdmin();
 * if (error) return error;
 */
export async function guardAdmin(): Promise<
  { session: AuthSession; error: null } | { session: null; error: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return {
      session: null,
      error: NextResponse.json(
        { error: "Non authentifié. Veuillez vous connecter." },
        { status: 401 }
      ),
    };
  }
  if (session.user.role !== "ADMIN") {
    return {
      session: null,
      error: NextResponse.json(
        { error: "Accès refusé. Droits ADMIN requis." },
        { status: 403 }
      ),
    };
  }
  return { session, error: null };
}
