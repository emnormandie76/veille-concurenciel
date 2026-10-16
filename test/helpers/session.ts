/**
 * test/helpers/session.ts — Sessions simulées pour les routes admin
 *
 *     const session = installSession();       // avant d'importer la route
 *     session.as("GESTIONNAIRE");
 *
 * `installSession` remplace `@/lib/auth` par `mock.module`. Les routes
 * appellent les mêmes noms (`guardSignedIn`, `guardManager`, `guardAdmin`…),
 * qui répondent selon le profil choisi : aucune session (par défaut), USER,
 * GESTIONNAIRE ou ADMIN. La règle et les messages viennent de lib/roles.ts,
 * comme dans la vraie lib/auth.ts : 401 sans session, 403 sous le niveau
 * requis. La logique de lib/auth.ts elle-même se teste à part
 * (test/auth.test.ts), et chaque route sous la vraie lib/auth.ts dans
 * test/api/access-matrix.test.ts.
 */

import { mock } from "node:test";
import { NextResponse } from "next/server";
import {
  REFUSAL_MESSAGES,
  UNAUTHENTICATED_MESSAGE,
  hasAccess,
  type AccessLevel,
  type UserRole,
} from "../../lib/roles";

export type SessionProfile = "none" | UserRole;

type FakeSession = {
  user: { id: string; name: string; email: string | null; role: UserRole };
};

const SESSIONS: Record<UserRole, FakeSession> = {
  USER: {
    user: { id: "test-user", name: "utilisateur", email: null, role: "USER" },
  },
  GESTIONNAIRE: {
    user: { id: "test-gestionnaire", name: "gestionnaire", email: null, role: "GESTIONNAIRE" },
  },
  ADMIN: {
    user: { id: "test-admin", name: "admin", email: null, role: "ADMIN" },
  },
};

type GuardName = "guardSignedIn" | "guardManager" | "guardAdmin";

export interface SessionControl {
  /** Change le profil des appels suivants. */
  as(profile: SessionProfile): void;
  /** Gardes appelées depuis le dernier `as()`, dans l'ordre. */
  guards: GuardName[];
}

export function installSession(initial: SessionProfile = "none"): SessionControl {
  let profile = initial;
  const guards: SessionControl["guards"] = [];

  const current = (): FakeSession | null =>
    profile === "none" ? null : SESSIONS[profile];

  function guard(name: GuardName, level: AccessLevel) {
    return async () => {
      guards.push(name);
      const session = current();
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
    };
  }

  const getSession = async () => current();

  mock.module("@/lib/auth", {
    exports: {
      getSession,
      guardSignedIn: guard("guardSignedIn", "signedIn"),
      guardManager: guard("guardManager", "manager"),
      guardAdmin: guard("guardAdmin", "admin"),
    },
  });

  return {
    as(next) {
      // Un profil inconnu (l'ancien MODERATOR…) passerait pour « aucune
      // session » sans rien dire : il lève.
      if (next !== "none" && !(next in SESSIONS)) {
        throw new Error(`Profil de session inconnu : ${String(next)}`);
      }
      profile = next;
      guards.length = 0;
    },
    guards,
  };
}
