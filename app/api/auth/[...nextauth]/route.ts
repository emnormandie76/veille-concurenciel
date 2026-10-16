/**
 * app/api/auth/[...nextauth]/route.ts — NextAuth v4 Credentials Provider (Étape 1.3)
 *
 * - Credentials Provider : vérifie username/password contre la table User (bcrypt)
 * - Rôle copié dans le jeton JWT et la session (USER | GESTIONNAIRE | ADMIN), à
 *   titre indicatif : il peut dater de 8 h, les gardes et les écrans relisent
 *   le rôle en base à chaque requête (lib/auth.ts, décision D1 du plan
 *   gestion-contenu)
 * - Pas d'auto-inscription : l'Admin crée les comptes (architecture.md §3.6)
 */

import NextAuth, { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { isUserRole, type UserRole } from "@/lib/roles";

export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Nom d'utilisateur", type: "text" },
        password: { label: "Mot de passe", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        // Recherche de l'utilisateur en BDD
        const user = await prisma.user.findUnique({
          where: { username: credentials.username },
        });

        if (!user) {
          return null; // Utilisateur inconnu → refus silencieux
        }

        // Vérification du mot de passe avec bcrypt
        const isValid = await bcrypt.compare(
          credentials.password,
          user.password_hash
        );

        if (!isValid) {
          return null; // Mauvais mot de passe → refus silencieux
        }

        // Retourner l'objet user (inclus dans le JWT)
        return {
          id: user.id,
          name: user.username,
          email: null,
          role: isUserRole(user.role) ? user.role : "USER",
        };
      },
    }),
  ],

  callbacks: {
    // Inclure le rôle dans le JWT token
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as unknown as { role: UserRole }).role;
        token.id = user.id;
      }
      return token;
    },
    // Inclure le rôle dans la session (accessible côté client)
    async session({ session, token }) {
      if (session.user) {
        (session.user as { role?: UserRole; id?: string }).role = token.role as UserRole;
        (session.user as { role?: UserRole; id?: string }).id = token.id as string;
      }
      return session;
    },
  },

  pages: {
    signIn: "/admin/login", // Page de login personnalisée (Étape 2)
  },

  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // Session de 8h (journée de travail)
  },

  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
