/**
 * proxy.ts — Protection des routes /admin/* (Étape 1.3)
 * Renommé depuis middleware.ts → proxy.ts (Next.js 16 convention)
 *
 * FIX : /admin/login est exclu du matcher pour éviter ERR_TOO_MANY_REDIRECTS.
 * withAuth redirige vers pages.signIn quand authorized=false → boucle si signIn
 * est dans le matcher. Solution : exclure login du matcher directement.
 *
 * - Référence : task.md §1.3, architecture.md §7.4
 */

import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(_req) {
    return NextResponse.next();
  },
  {
    callbacks: {
      // authorized est appelé uniquement pour les routes dans le matcher
      // /admin/login est exclu du matcher → pas de boucle possible
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: "/admin/login",
    },
  }
);

// Matcher : /admin/* SAUF /admin/login (négatif lookahead)
export const config = {
  matcher: ["/admin/((?!login$|login/).*)"],
};
