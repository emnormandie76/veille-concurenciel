import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

// ──────────────────────────────────────────────────────────────
// Limitation de débit
//
// L'implémentation vit dans lib/rate-limit.ts — source unique du projet. Elle
// s'appuie sur un magasin partagé (Upstash Redis) dès que les variables
// UPSTASH_REDIS_REST_* sont définies, et retombe sinon sur un compteur mémoire
// qui ne tient pas sur une plateforme sans état.
// ──────────────────────────────────────────────────────────────

function tooManyRequests(message: string, retryAfterSeconds: number): NextResponse {
  return new NextResponse(JSON.stringify({ error: message }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfterSeconds),
    },
  });
}

// Chemin sur lequel NextAuth vérifie les identifiants.
const CREDENTIALS_CALLBACK = "/api/auth/callback/credentials";

// ~5 tentatives de connexion par IP et par tranche de 15 minutes.
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// 5 contributions par IP et par tranche de 20 secondes (Edge Case 1).
const CONTRIBUTE_LIMIT = 5;
const CONTRIBUTE_WINDOW_MS = 20 * 1000;

// API publique de lecture : sans plafond, un seul client aspire la base entière
// et sature le palier gratuit Neon. 60 requêtes/minute laisse largement la place
// à un usage normal, y compris une page qui enchaîne plusieurs appels.
const V1_LIMIT = 60;
const V1_WINDOW_MS = 60 * 1000;

// Protection de session pour /admin/* uniquement.
const sessionMiddleware = withAuth({
  callbacks: {
    // Les chemins publics du matcher sont interceptés en amont et ne
    // parviennent jamais ici : seul /admin/* atteint ce callback.
    authorized: ({ token }) => !!token,
  },
  pages: {
    signIn: "/admin/login",
  },
});

/**
 * IMPORTANT — la limitation de débit ne peut pas vivre dans le callback interne
 * de withAuth : handleMiddleware() de next-auth sort avant de l'appeler dès que
 * le chemin commence par /api/auth (node_modules/next-auth/next/middleware.js).
 * Elle est donc appliquée ici, en amont, et withAuth n'est délégué que pour les
 * chemins qui ont réellement besoin d'une session.
 */
export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  const { pathname } = req.nextUrl;

  // 1. Vérification des identifiants : plafonner la force brute.
  //    Seul le POST est compté, c'est lui qui porte la soumission.
  if (pathname === CREDENTIALS_CALLBACK) {
    if (req.method === "POST") {
      const ip = clientIp(req.headers);
      if (!(await checkRateLimit(`login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS))) {
        console.warn(`[auth] plafond de tentatives de connexion atteint pour ip=${ip}`);
        return tooManyRequests(
          "Trop de tentatives de connexion. Réessayez dans quelques minutes.",
          LOGIN_WINDOW_MS / 1000
        );
      }
    }
    return NextResponse.next();
  }

  // 2. Endpoint public de contribution.
  if (pathname.startsWith("/api/contribute")) {
    const ip = clientIp(req.headers);
    if (!(await checkRateLimit(`contribute:${ip}`, CONTRIBUTE_LIMIT, CONTRIBUTE_WINDOW_MS))) {
      return tooManyRequests("Rate limit dépassé", CONTRIBUTE_WINDOW_MS / 1000);
    }
    return NextResponse.next();
  }

  // 3. API publique de lecture : plafonnée, jamais authentifiée.
  //    Les pré-vols CORS ne consomment pas de quota.
  if (pathname.startsWith("/api/v1")) {
    if (req.method === "OPTIONS") return NextResponse.next();
    const ip = clientIp(req.headers);
    if (!(await checkRateLimit(`v1:${ip}`, V1_LIMIT, V1_WINDOW_MS))) {
      return tooManyRequests(
        "Trop de requêtes sur l'API publique. Réessayez dans une minute.",
        V1_WINDOW_MS / 1000
      );
    }
    return NextResponse.next();
  }

  // 4. Back-office : session obligatoire.
  // Le cast est sûr : withAuth(options) n'attache `nextauth` à la requête que
  // lorsqu'un middleware interne lui est passé, ce qui n'est pas le cas ici.
  return sessionMiddleware(req as NextRequestWithAuth, event);
}

// Matcher : /admin/* (hors login), /api/contribute, le callback de connexion et
// l'API publique v1.
export const config = {
  matcher: [
    "/admin/((?!login$|login/).*)",
    "/api/contribute",
    "/api/auth/callback/credentials",
    "/api/v1/:path*",
  ],
};
