/**
 * types/next-auth.d.ts — Extension des types NextAuth v4
 * Ajoute le champ `role` et `id` à Session et JWT.
 *
 * Le rôle du jeton date de la connexion (jusqu'à 8 h) : il ne sert jamais à
 * juger un accès. lib/auth.ts relit le rôle en base (décision D1).
 */

import "next-auth";
import "next-auth/jwt";
import type { UserRole } from "@/lib/roles";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: UserRole;
    };
  }

  interface User {
    id: string;
    role: UserRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
  }
}
