/**
 * types/next-auth.d.ts — Extension des types NextAuth v4
 * Ajoute le champ `role` et `id` à Session et JWT.
 */

import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: "ADMIN" | "MODERATOR";
    };
  }

  interface User {
    id: string;
    role: "ADMIN" | "MODERATOR";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "ADMIN" | "MODERATOR";
  }
}
