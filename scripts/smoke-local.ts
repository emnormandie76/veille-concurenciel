/**
 * scripts/smoke-local.ts — Contrôle de fumée du site local, lancé à la main
 *
 *     npm run dev                         # dans un autre terminal
 *     npm run smoke                       # http://localhost:3000 par défaut
 *     npm run smoke -- http://127.0.0.1:3001
 *
 * Plan backend-local, étape 7 ; adapté aux étapes 1 (connexion obligatoire)
 * et 2 (liste blanche) du plan gestion-contenu. Deux phases :
 *
 * 1. **Le mur**, sans session : la connexion et la première connexion
 *    répondent 200 ; chaque page (`/`, `/api-docs`, les deux fiches,
 *    `/account`, `/admin/schools`) renvoie vers la connexion avec son chemin en
 *    `callbackUrl` ; `/api/schools` et chaque GET de l'API v1 répondent 401.
 *    Le proxy refuse avant toute lecture en base.
 * 2. **Le contenu, connecté**, si `APPVC_ADMIN_PASSWORD` et un identifiant
 *    sont posés (variables utilisateur Windows, posées par le propriétaire ;
 *    jamais affichées) : `APPVC_ADMIN_EMAIL`, ou `APPVC_ADMIN_USERNAME` tant
 *    que le compte n'a pas d'adresse (D3). Connexion par NextAuth, puis les
 *    pages et les 15 GET de l'API v1 avec la session. Attend un 200, un JSON
 *    lisible pour l'API, et l'absence de page d'erreur Next dans le HTML. Sans
 *    ces variables, la phase est sautée et le dit.
 *
 * Les règles sont dans scripts/lib/smoke-checks.ts, testé en CI.
 *
 * Lecture seule : des GET, et un POST de connexion (un échec compterait dans le
 * plafond de la connexion, D117 ; une réussite, non). Ni écriture ni appel payant (aucune de ces
 * pages ne joint le backend). Mais `npm run dev` lit la base des fichiers
 * `.env*` du poste : à lancer avec l'accord du propriétaire. Pas en CI, faute
 * de base. Toute adresse non locale est refusée.
 *
 * L'école choisie est la première, par nom, qui a au moins un programme. Une
 * école sans statistiques rend 404 sur `/stats` : c'est noté « absent », pas
 * compté comme une panne. Sans campus, `/campuses/[id]` est sauté.
 *
 * Code de sortie : 0 si rien n'échoue, 1 sinon, 2 si l'adresse est refusée.
 */

import {
  buildChecks,
  buildWallChecks,
  cookieHeader,
  judge,
  judgeWall,
  localBaseUrl,
  smokeCredentials,
  type SmokeCheck,
  type SmokeIds,
  type SmokeVerdict,
} from "./lib/smoke-checks";
import { LOGIN_BLOCKED } from "../lib/roles";

// La première compilation d'une page par `next dev` peut prendre longtemps.
const TIMEOUT_MS = 120_000;
// Écoles essayées pour trouver un programme ; l'API v1 est limitée à 60
// requêtes par minute et par IP (proxy.ts).
const MAX_SCHOOLS_TRIED = 10;

const SIGNS = { ok: "✓", absent: "·", fail: "✗", skipped: "–" } as const;

interface CallResult {
  status: number;
  contentType: string;
  text: string;
  location: string | null;
  setCookies: string[];
  ms: number;
}

async function call(
  base: URL,
  path: string,
  init: { cookie?: string; method?: string; body?: string; contentType?: string } = {}
): Promise<CallResult> {
  const started = Date.now();
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  if (init.contentType) headers["content-type"] = init.contentType;
  const res = await fetch(new URL(path, base), {
    method: init.method ?? "GET",
    headers,
    body: init.body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "manual",
  });
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    text: await res.text(),
    location: res.headers.get("location"),
    setCookies: res.headers.getSetCookie(),
    ms: Date.now() - started,
  };
}

function line(sign: string, path: string, ms: number | undefined, detail: string) {
  const time = ms === undefined ? "" : `${ms} ms`;
  console.log(`  ${sign} ${path.padEnd(64)} ${time.padStart(8)}  ${detail}`);
}

function report(check: SmokeCheck, verdict: SmokeVerdict | "skipped", ms?: number) {
  const sign = verdict === "skipped" ? SIGNS.skipped : SIGNS[verdict.outcome];
  const detail = verdict === "skipped" ? `sauté : ${check.skipped}` : (verdict.detail ?? "");
  line(sign, check.path ?? check.route, ms, detail);
}

/**
 * Ouvre une session par NextAuth (jeton CSRF, puis identifiants) et rend
 * l'en-tête Cookie qui la porte. Les identifiants ne sont jamais affichés.
 */
async function signIn(base: URL, login: string, password: string): Promise<string> {
  const csrf = await call(base, "/api/auth/csrf");
  if (csrf.status !== 200) throw new Error(`/api/auth/csrf : HTTP ${csrf.status}.`);
  const { csrfToken } = JSON.parse(csrf.text) as { csrfToken: string };

  const answer = await call(base, "/api/auth/callback/credentials", {
    method: "POST",
    cookie: cookieHeader(csrf.setCookies),
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams({ csrfToken, login, password, json: "true" }).toString(),
  });
  const cookie = cookieHeader([...csrf.setCookies, ...answer.setCookies]);
  if (!/session-token=/.test(cookie)) {
    // D117 : le plafond ne compte que les échecs ; NextAuth rend alors son erreur dans l'adresse de retour.
    throw new Error(
      answer.text.includes(LOGIN_BLOCKED)
        ? "connexion refusée : plafond d'échecs atteint (5 sur ce compte, ou 20 sur cette IP), réessayer dans 15 minutes."
        : "connexion refusée : identifiants APPVC_ADMIN_* incorrects ?"
    );
  }
  return cookie;
}

/** Lit un JSON de l'API v1 pour choisir les identifiants ; lève si la réponse n'est pas bonne. */
async function readJson(base: URL, path: string, cookie: string): Promise<unknown> {
  const res = await call(base, path, { cookie });
  if (res.status !== 200) throw new Error(`${path} : HTTP ${res.status} pendant le choix de l'école.`);
  return JSON.parse(res.text);
}

async function chooseIds(base: URL, cookie: string): Promise<SmokeIds> {
  const { data: schools } = (await readJson(base, "/api/v1/schools?limit=100", cookie)) as { data: { id: string; name: string }[] };
  if (schools.length === 0) throw new Error("Aucune école ACTIVE : la base est-elle vide ?");

  for (const school of schools.slice(0, MAX_SCHOOLS_TRIED)) {
    const programs = (await readJson(base, `/api/v1/schools/${school.id}/programs`, cookie)) as { id: string }[];
    if (programs.length === 0) continue;
    const campuses = (await readJson(base, `/api/v1/schools/${school.id}/campuses`, cookie)) as { id: string }[];
    console.log(`École choisie : ${school.name} (${school.id})\n`);
    return { schoolId: school.id, programId: programs[0].id, campusId: campuses[0]?.id ?? null };
  }
  throw new Error(`Aucune des ${Math.min(schools.length, MAX_SCHOOLS_TRIED)} premières écoles n'a de programme.`);
}

async function main(): Promise<number> {
  let base: URL;
  try {
    base = localBaseUrl(process.argv[2] ?? process.env.SMOKE_BASE_URL ?? "http://localhost:3000");
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }

  console.log(`Smoke local — ${base.origin}\n`);
  const counts = { ok: 0, absent: 0, fail: 0, skipped: 0 };

  // 1. Le mur : sans session, seule la connexion est ouverte.
  console.log("Sans session : le mur\n");
  for (const check of buildWallChecks()) {
    let verdict: SmokeVerdict;
    let ms: number | undefined;
    try {
      const res = await call(base, check.path);
      ms = res.ms;
      verdict = judgeWall(check, res);
    } catch (error) {
      if ((error as Error).name === "TypeError") {
        console.error(`✗ ${base.origin} ne répond pas : npm run dev est-il lancé ?`);
        return 1;
      }
      verdict = { outcome: "fail", detail: `pas de réponse (${(error as Error).message})` };
    }
    counts[verdict.outcome]++;
    line(SIGNS[verdict.outcome], check.path, ms, verdict.detail ?? "");
  }

  // 2. Le contenu, connecté : seulement si le propriétaire a posé les identifiants.
  const credentials = smokeCredentials(process.env);
  if (!credentials) {
    console.log(
      "\nConnecté : sauté, APPVC_ADMIN_PASSWORD et APPVC_ADMIN_EMAIL (ou APPVC_ADMIN_USERNAME) absentes."
    );
    console.log(`\n${counts.ok} bons, ${counts.fail} en échec.`);
    return counts.fail === 0 ? 0 : 1;
  }

  // Seul le nom de la variable est affiché, jamais sa valeur.
  console.log(`\nConnecté (identifiant tiré de ${credentials.from}) : les pages et l'API\n`);
  let ids: SmokeIds;
  let cookie: string;
  try {
    cookie = await signIn(base, credentials.login, credentials.password);
    ids = await chooseIds(base, cookie);
  } catch (error) {
    console.error(`✗ ${(error as Error).message}`);
    return 1;
  }

  for (const check of buildChecks(ids)) {
    if (check.path === null) {
      counts.skipped++;
      report(check, "skipped");
      continue;
    }
    let verdict: SmokeVerdict;
    let ms: number | undefined;
    try {
      const res = await call(base, check.path, { cookie });
      ms = res.ms;
      verdict = judge(check, res);
    } catch (error) {
      verdict = { outcome: "fail", detail: `pas de réponse (${(error as Error).message})` };
    }
    counts[verdict.outcome]++;
    report(check, verdict, ms);
  }

  console.log(
    `\n${counts.ok} bons, ${counts.fail} en échec, ${counts.absent} absents (donnée manquante), ${counts.skipped} sautés.`
  );
  return counts.fail === 0 ? 0 : 1;
}

main().then((code) => process.exit(code));
