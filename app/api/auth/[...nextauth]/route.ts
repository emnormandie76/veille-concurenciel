/**
 * app/api/auth/[...nextauth]/route.ts — NextAuth v4, identifiants de la liste blanche
 *
 * - Credentials Provider : l'adresse de travail (ou l'ancien identifiant d'un
 *   compte qui n'a pas encore d'adresse, D3) et le mot de passe, vérifiés par
 *   lib/sign-in.ts (bcrypt) ; seul un compte actif se connecte ; seuls les
 *   échecs comptent dans le plafond, par compte et par IP (D117)
 * - Rôle copié dans le jeton JWT et la session (USER | GESTIONNAIRE | ADMIN), à
 *   titre indicatif : il peut dater de 8 h, les gardes et les écrans relisent
 *   le rôle en base à chaque requête (lib/auth.ts, décision D1 du plan
 *   gestion-contenu)
 * - Version de session copiée dans le jeton : lib/auth.ts la compare à celle
 *   du compte, ce qui coupe les sessions d'un compte remis à zéro (D20)
 * - Pas d'auto-inscription : l'admin ajoute les adresses à la liste blanche, et
 *   la personne choisit son mot de passe à sa première connexion
 *   (app/api/first-login, décision G5)
 */

import NextAuth, { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { ipFromHeaders } from "@/lib/login-attempts";
import { authCallbacks, authorizeCredentials } from "@/lib/sign-in";
import { LOGIN_PATH } from "@/lib/roles";

export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        login: { label: "Adresse e-mail", type: "text" },
        password: { label: "Mot de passe", type: "password" },
      },
      // Refus silencieux (null) : ni le compte ni la raison ne sont dits. Seul
      // le blocage du plafond se dit (D117) : la page le reconnaît à son erreur.
      authorize: (credentials, req) =>
        authorizeCredentials(credentials?.login, credentials?.password, ipFromHeaders(req?.headers)),
    }),
  ],

  callbacks: authCallbacks,

  pages: {
    signIn: LOGIN_PATH,
  },

  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // Session de 8h (journée de travail)
  },

  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
