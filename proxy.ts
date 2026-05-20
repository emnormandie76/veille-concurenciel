/**
 * proxy.ts — Protection des routes /admin/* (Étape 1.3)
 * Renommé depuis middleware.ts → proxy.ts (Next.js 16 convention)
 *
 * - Protège TOUTES les routes /admin/* SAUF /admin/login
 * - Redirige vers /admin/login si pas de session valide
 * - Référence : task.md §1.3, architecture.md §7.4
 */

import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    // Middleware exécuté uniquement si le callback `authorized` retourne true
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const { pathname } = req.nextUrl;

        // /admin/login est toujours accessible (pas de token requis)
        if (pathname === "/admin/login") {
          return true;
        }

        // Toutes les autres routes /admin/* nécessitent un token valide
        if (pathname.startsWith("/admin")) {
          return !!token;
        }

        // Routes publiques : toujours autorisées
        return true;
      },
    },
    pages: {
      signIn: "/admin/login",
    },
  }
);

// Appliquer le middleware uniquement aux routes /admin/*
export const config = {
  matcher: ["/admin/:path*"],
};
