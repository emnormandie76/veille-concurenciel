/**
 * scripts/lib/smoke-checks.ts — Ce que vérifie le smoke local, et comment il juge
 *
 * MODULE PUR : ni base, ni réseau, ni fichier. `scripts/smoke-local.ts` fait
 * les appels HTTP ; ce module dit quoi appeler et si la réponse est bonne. Il
 * est testé en CI (test/smoke-checks.test.ts), le smoke lui-même ne l'est pas :
 * il lui faut `npm run dev` et la base.
 *
 * Voir docs/features/backend-local.md, étape 7. Depuis l'étape 1 du plan
 * gestion-contenu, le site exige une session : le smoke joue d'abord le mur
 * (`buildWallChecks`, `judgeWall`), puis les pages et l'API avec la session
 * (`buildChecks`, `judge`).
 */

/** Les 15 routes GET de l'API v1 (API-rest.md), dans l'ordre de la doc. */
export const V1_ROUTES = [
  "/api/v1/schools",
  "/api/v1/schools/[id]",
  "/api/v1/schools/[id]/stats",
  "/api/v1/schools/[id]/accreditations",
  "/api/v1/schools/[id]/campuses",
  "/api/v1/campuses/[id]",
  "/api/v1/schools/[id]/programs",
  "/api/v1/programs/[id]",
  "/api/v1/programs",
  "/api/v1/programs/[id]/pricing",
  "/api/v1/schools/[id]/pricing",
  "/api/v1/programs/[id]/rankings",
  "/api/v1/rankings",
  "/api/v1/programs/[id]/capacity",
  "/api/v1/compare/programs",
] as const;

/** Les pages du site appelées (plan backend-local, étape 7 ; /contribute retirée, D2). */
export const PAGES = ["/", "/api-docs", "/schools/[id]", "/schools/[id]/programs/[pid]"] as const;

export interface SmokeIds {
  schoolId: string;
  programId: string;
  /** `null` si l'école n'a aucun campus : `/api/v1/campuses/[id]` est alors sauté. */
  campusId: string | null;
}

export interface SmokeCheck {
  kind: "page" | "api";
  /** Le gabarit, tel qu'il figure dans `V1_ROUTES` ou `PAGES`. */
  route: string;
  /** Le chemin appelé, identifiants posés ; `null` si le contrôle est sauté. */
  path: string | null;
  /** Pourquoi le contrôle est sauté. */
  skipped?: string;
  /** Un 404 JSON dont le message correspond est une absence de donnée, pas une panne. */
  missingOk?: RegExp;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * L'adresse de base du smoke, refusée si elle n'est pas locale : il est fait
 * pour `npm run dev` sur le poste, jamais pour un site en ligne.
 */
export function localBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Adresse illisible : « ${raw} ».`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Adresse refusée : « ${raw} » n'est pas en http ni en https.`);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `Adresse refusée : « ${url.hostname} » n'est pas locale. Le smoke vise npm run dev sur ce poste (localhost, 127.0.0.1).`
    );
  }
  return url;
}

/** Pose les identifiants dans un gabarit de `V1_ROUTES` ou de `PAGES`. */
function fill(route: string, ids: SmokeIds): string | null {
  if (route.startsWith("/api/v1/campuses/")) {
    return ids.campusId ? route.replace("[id]", encodeURIComponent(ids.campusId)) : null;
  }
  if (route === "/api/v1/compare/programs") return `${route}?ids=${encodeURIComponent(ids.programId)}`;
  const id = route.startsWith("/api/v1/programs/") ? ids.programId : ids.schoolId;
  return route.replace("[id]", encodeURIComponent(id)).replace("[pid]", encodeURIComponent(ids.programId));
}

/** Les contrôles à jouer, pages d'abord, puis les 15 routes de l'API v1. */
export function buildChecks(ids: SmokeIds): SmokeCheck[] {
  const pages: SmokeCheck[] = PAGES.map((route) => ({ kind: "page", route, path: fill(route, ids) }));
  const api: SmokeCheck[] = V1_ROUTES.map((route) => {
    const path = fill(route, ids);
    const check: SmokeCheck = { kind: "api", route, path };
    if (path === null) check.skipped = "l'école choisie n'a aucun campus";
    // Une école peut ne pas avoir encore de statistiques : la route le dit en 404.
    if (route === "/api/v1/schools/[id]/stats") check.missingOk = /Statistiques introuvables/;
    return check;
  });
  return [...pages, ...api];
}

// Des « digests » que React pose sans erreur : rendu repoussé au navigateur.
const BENIGN_DIGESTS = /^(BAILOUT_TO_CLIENT_SIDE_RENDERING|NEXT_DYNAMIC_NO_SSR_CODE)/;

/** Le HTML sans ses `<script>`, où vit la charge RSC. */
function withoutScripts(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

/** La marque d'une page d'erreur Next dans un HTML rendu, ou `null`. */
export function nextErrorMarker(html: string): string | null {
  if (html.includes('id="__next_error__"')) return "page d'erreur de Next (__next_error__)";
  if (html.includes("data-next-error-digest")) return "erreur serveur rendue dans la page (data-next-error-digest)";
  // Next 16 sérialise la frontière not-found par défaut dans la charge RSC de
  // chaque page, page saine comprise : la phrase ne compte que hors <script>.
  if (withoutScripts(html).includes("This page could not be found")) return "page 404 de Next";
  for (const match of html.matchAll(/data-dgst="([^"]*)"/g)) {
    if (!BENIGN_DIGESTS.test(match[1])) return `erreur de rendu (digest ${match[1]})`;
  }
  return null;
}

export interface SmokeResponse {
  status: number;
  contentType: string;
  text: string;
  /** En-tête Location d'une redirection, s'il y en a une. */
  location?: string | null;
}

export type SmokeVerdict = { outcome: "ok" | "absent" | "fail"; detail?: string };

/** Juge une réponse : 200, JSON lisible pour l'API, HTML sans page d'erreur Next. */
export function judge(check: SmokeCheck, response: SmokeResponse): SmokeVerdict {
  const { status, contentType, text } = response;

  if (check.kind === "api") {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { outcome: "fail", detail: `HTTP ${status}, réponse qui n'est pas du JSON` };
    }
    const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
    if (status === 200) return { outcome: "ok" };
    if (status === 404 && check.missingOk && typeof error === "string" && check.missingOk.test(error)) {
      return { outcome: "absent", detail: error };
    }
    return { outcome: "fail", detail: `HTTP ${status}${typeof error === "string" ? ` : ${error}` : ""}` };
  }

  if (status !== 200) return { outcome: "fail", detail: `HTTP ${status}` };
  if (!contentType.includes("text/html")) return { outcome: "fail", detail: `type ${contentType || "absent"}, HTML attendu` };
  const marker = nextErrorMarker(text);
  return marker ? { outcome: "fail", detail: marker } : { outcome: "ok" };
}

// ── Le mur : sans session (plan gestion-contenu, étape 1) ─────────────

export interface WallCheck {
  /** Le chemin appelé, sans session. */
  path: string;
  /**
   * `open` : la page de connexion, 200 attendu ; `redirect` : une page, renvoi
   * vers la connexion avec son chemin en `callbackUrl` ; `unauthorized` : une
   * API, 401 en JSON.
   */
  expect: "open" | "redirect" | "unauthorized";
}

export const LOGIN_PAGE = "/admin/login";

// Identifiants factices : le proxy refuse avant toute lecture en base.
const WALL_IDS: SmokeIds = { schoolId: "mur", programId: "mur", campusId: "mur" };

/** Les contrôles du mur : la connexion, chaque page, le back-office, puis les API. */
export function buildWallChecks(): WallCheck[] {
  const pages = PAGES.map((route) => fill(route, WALL_IDS)!);
  return [
    { path: LOGIN_PAGE, expect: "open" },
    ...[...pages, "/admin/schools"].map((path): WallCheck => ({ path, expect: "redirect" })),
    ...["/api/schools", ...V1_ROUTES.map((route) => fill(route, WALL_IDS)!)].map(
      (path): WallCheck => ({ path, expect: "unauthorized" })
    ),
  ];
}

/** Juge une réponse sans session : seule la connexion est ouverte. */
export function judgeWall(check: WallCheck, response: SmokeResponse): SmokeVerdict {
  const { status, contentType, text, location } = response;

  if (check.expect === "open") {
    if (status !== 200) return { outcome: "fail", detail: `HTTP ${status}, la connexion doit rester ouverte` };
    if (!contentType.includes("text/html")) return { outcome: "fail", detail: `type ${contentType || "absent"}, HTML attendu` };
    const marker = nextErrorMarker(text);
    return marker ? { outcome: "fail", detail: marker } : { outcome: "ok" };
  }

  if (check.expect === "redirect") {
    if (![302, 303, 307, 308].includes(status) || !location) {
      return { outcome: "fail", detail: `HTTP ${status} : ouvert sans session` };
    }
    const target = new URL(location, "http://smoke.invalid");
    if (target.pathname !== LOGIN_PAGE) return { outcome: "fail", detail: `renvoi vers ${target.pathname}` };
    if (target.searchParams.get("callbackUrl") !== check.path) {
      return { outcome: "fail", detail: `callbackUrl « ${target.searchParams.get("callbackUrl")} »` };
    }
    return { outcome: "ok" };
  }

  if (status !== 401) return { outcome: "fail", detail: `HTTP ${status} : ouvert sans session` };
  try {
    const body = JSON.parse(text) as { error?: unknown };
    if (typeof body.error === "string") return { outcome: "ok" };
  } catch {
    // Un 401 qui n'est pas du JSON : jugé ci-dessous.
  }
  return { outcome: "fail", detail: "401 sans corps JSON { error }" };
}

// ── La session : les cookies de NextAuth ─────────────────────────────

/**
 * L'en-tête Cookie à renvoyer, tiré des Set-Cookie reçus : les paires
 * nom=valeur, sans attributs ; un cookie effacé (valeur vide) n'est pas repris.
 */
export function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((line) => line.split(";")[0].trim())
    .filter((pair) => /^[^=]+=.+$/.test(pair))
    .join("; ");
}
