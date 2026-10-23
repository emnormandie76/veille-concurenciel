import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { FIRST_LOGIN_API, FIRST_LOGIN_PATH, LOGIN_PATH, UNAUTHENTICATED_MESSAGE } from "@/lib/roles";

// ──────────────────────────────────────────────────────────────
// Connexion obligatoire (plan gestion-contenu, étape 1 ; décision G6)
//
// Tout le site exige une session : pages, /api-docs, /api/schools/*, l'API v1
// et le back-office. Seules restent libres la page de connexion, /api/auth/*
// (NextAuth) et, depuis l'étape 2 (G5), la première connexion : sa page et sa
// route (lib/roles.ts). Sans session, une page renvoie vers la connexion avec
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

// La connexion et la première connexion ne se plafonnent plus ici (D117) :
// seuls leurs échecs comptent, par compte et par IP, et le proxy ne voit pas
// l'issue d'une connexion. Le plafond vit dans lib/login-attempts.ts, que la
// connexion (lib/sign-in.ts) et la première connexion consultent.

// API de lecture : sans plafond, un seul client aspire la base entière et
// sature le palier gratuit Neon. 60 requêtes/minute laisse largement la place
// à un usage normal, y compris une page qui enchaîne plusieurs appels. Seules
// les requêtes connectées sont comptées : un appel refusé ne consomme pas le
// quota de l'IP, que des collègues peuvent partager.
const V1_LIMIT = 60;
const V1_WINDOW_MS = 60 * 1000;

/** Les seuls chemins ouverts sans session (test/proxy.test.ts, FREE). */
function isPublicPath(pathname: string): boolean {
  return (
    pathname === LOGIN_PATH ||
    pathname === `${LOGIN_PATH}/` ||
    pathname === FIRST_LOGIN_PATH ||
    pathname === `${FIRST_LOGIN_PATH}/` ||
    pathname === FIRST_LOGIN_API ||
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

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. La connexion, la première connexion et NextAuth : libres. Leurs échecs
  //    se comptent plus loin, là où l'issue se connaît (D117).
  if (isPublicPath(pathname)) return NextResponse.next();

  // 2. Tout le reste : session obligatoire.
  if (!(await hasSession(req))) return refuse(req);

  // 3. API v1 : plafonnée, par IP. Les pré-vols CORS ne consomment pas de quota.
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
