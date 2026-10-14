/**
 * test/helpers/session.ts — Sessions simulées pour les routes admin
 *
 *     const session = installSession();       // avant d'importer la route
 *     session.as("MODERATOR");
 *
 * `installSession` remplace `@/lib/auth` par `mock.module`. Les routes
 * appellent les mêmes noms (`guardAuth`, `guardAdmin`…), qui répondent selon
 * le profil choisi : aucune session (par défaut), MODERATOR ou ADMIN. Les
 * réponses reprennent celles de lib/auth.ts : 401 sans session, 403 pour un
 * MODERATOR sur une garde ADMIN. La logique de lib/auth.ts elle-même se teste
 * à part (plan backend-local, étape 7).
 */

import { mock } from "node:test";
import { NextResponse } from "next/server";

export type SessionProfile = "none" | "MODERATOR" | "ADMIN";

type FakeSession = {
  user: { id: string; name: string; email: string | null; role: "ADMIN" | "MODERATOR" };
};

const SESSIONS: Record<Exclude<SessionProfile, "none">, FakeSession> = {
  MODERATOR: {
    user: { id: "test-moderator", name: "moderateur", email: null, role: "MODERATOR" },
  },
  ADMIN: {
    user: { id: "test-admin", name: "admin", email: null, role: "ADMIN" },
  },
};

export interface SessionControl {
  /** Change le profil des appels suivants. */
  as(profile: SessionProfile): void;
  /** Gardes appelées depuis le dernier `as()`, dans l'ordre. */
  guards: ("guardAuth" | "guardAdmin")[];
}

export function installSession(initial: SessionProfile = "none"): SessionControl {
  let profile = initial;
  const guards: SessionControl["guards"] = [];

  const current = (): FakeSession | null =>
    profile === "none" ? null : SESSIONS[profile];

  const unauthenticated = () => ({
    session: null,
    error: NextResponse.json(
      { error: "Non authentifié. Veuillez vous connecter." },
      { status: 401 }
    ),
  });

  async function guardAuth() {
    guards.push("guardAuth");
    const session = current();
    if (!session) return unauthenticated();
    return { session, error: null };
  }

  async function guardAdmin() {
    guards.push("guardAdmin");
    const session = current();
    if (!session) return unauthenticated();
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

  const getSession = async () => current();
  const requireAdmin = async () => {
    const session = current();
    return session?.user.role === "ADMIN" ? session : null;
  };

  mock.module("@/lib/auth", {
    exports: {
      getSession,
      requireAuth: getSession,
      requireAdmin,
      guardAuth,
      guardAdmin,
    },
  });

  return {
    as(next) {
      profile = next;
      guards.length = 0;
    },
    guards,
  };
}
