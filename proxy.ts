import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { LOGIN_PATH, UNAUTHENTICATED_MESSAGE } from "@/lib/roles";

// ──────────────────────────────────────────────────────────────
// Connexion obligatoire (plan gestion-contenu, étape 1 ; décision G6)
//
// Tout le site exige une session : pages, /api-docs, /api/schools/*, l'API v1
// et le back-office. Seules la page de connexion et /api/auth/* (NextAuth)
// restent libres. Sans session, une page renvoie vers la connexion avec
// `callbackUrl`, une route /api/* répond 401 en JSON.
//
// Le proxy ne regarde que l'existence d'une session valide (jeton signé avec
// NEXTAUTH_SECRET) : c'est un contrôle « optimiste », au sens de la doc de
// Next 16. Le rôle se contrôle côté serveur, relu en base à chaque requête
// (lib/auth.ts, décision D1) : dans les gardes des API et dans les écrans du
// back-office (`requirePage`).
//
// Les pages publiques et les API de lecture sont en cache ISR d'une heure : le
// proxy passe avant le cache, le mur tient (plan, piège 4).
// ──────────────────────────────────────────────────────────────

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

// API de lecture : sans plafond, un seul client aspire la base entière et
// sature le palier gratuit Neon. 60 requêtes/minute laisse largement la place
// à un usage normal, y compris une page qui enchaîne plusieurs appels. Seules
// les requêtes connectées sont comptées : un appel refusé ne consomme pas le
// quota de l'IP, que des collègues peuvent partager.
const V1_LIMIT = 60;
const V1_WINDOW_MS = 60 * 1000;

/** Les seuls chemins ouverts sans session. */
function isPublicPath(pathname: string): boolean {
  return (
    pathname === LOGIN_PATH ||
    pathname === `${LOGIN_PATH}/` ||
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/")
  );
}

/** Vrai si la requête porte un jeton de session valide. */
async function hasSession(req: NextRequest): Promise<boolean> {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    // Sans secret, aucun jeton ne se vérifie : tout reste fermé.
    console.error("[auth] NEXTAUTH_SECRET absent : toute requête est refusée");
    return false;
  }
  // getToken rend null sur un jeton absent, expiré ou signé avec un autre secret.
  return (await getToken({ req, secret })) !== null;
}

function refuse(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: UNAUTHENTICATED_MESSAGE }, { status: 401 });
  }
  const signIn = new URL(LOGIN_PATH, req.nextUrl.origin);
  signIn.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(signIn);
}

/**
 * IMPORTANT — la limitation de débit de la connexion passe avant tout : le
 * POST des identifiants arrive sans session, et NextAuth le traite ensuite.
 */
export default async function proxy(req: NextRequest) {
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

  // 2. La connexion et NextAuth : libres.
  if (isPublicPath(pathname)) return NextResponse.next();

  // 3. Tout le reste : session obligatoire.
  if (!(await hasSession(req))) return refuse(req);

  // 4. API v1 : plafonnée, par IP. Les pré-vols CORS ne consomment pas de quota.
  if (pathname.startsWith("/api/v1")) {
    if (req.method === "OPTIONS") return NextResponse.next();
    const ip = clientIp(req.headers);
    if (!(await checkRateLimit(`v1:${ip}`, V1_LIMIT, V1_WINDOW_MS))) {
      return tooManyRequests(
        "Trop de requêtes sur l'API. Réessayez dans une minute.",
        V1_WINDOW_MS / 1000
      );
    }
  }

  return NextResponse.next();
}

// Matcher : tout, sauf les fichiers statiques de Next et l'icône. Une page ou
// une route ajoutée est couverte d'office (test/proxy.test.ts énumère app/).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
