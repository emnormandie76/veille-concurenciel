/**
 * scripts/smoke-local.ts — Contrôle de fumée du site local, lancé à la main
 *
 *     npm run dev                         # dans un autre terminal
 *     npm run smoke                       # http://localhost:3000 par défaut
 *     npm run smoke -- http://127.0.0.1:3001
 *
 * Plan backend-local, étape 7. Appelle les pages publiques (`/`, `/contribute`,
 * `/api-docs`, la fiche d'une école et celle d'un de ses programmes) puis
 * chaque GET de l'API v1 (15 routes). Attend un 200, un JSON lisible pour
 * l'API, et l'absence de page d'erreur Next dans le HTML. Les règles sont dans
 * scripts/lib/smoke-checks.ts, testé en CI.
 *
 * Lecture seule : des GET, ni écriture ni appel payant (aucune de ces pages ne
 * joint le backend). Mais `npm run dev` lit la base de `.env.local`, dont la
 * branche `main` est aussi la production : à lancer avec l'accord du
 * propriétaire. Pas en CI, faute de base. Toute adresse non locale est refusée.
 *
 * L'école choisie est la première, par nom, qui a au moins un programme. Une
 * école sans statistiques rend 404 sur `/stats` : c'est noté « absent », pas
 * compté comme une panne. Sans campus, `/campuses/[id]` est sauté.
 *
 * Code de sortie : 0 si rien n'échoue, 1 sinon, 2 si l'adresse est refusée.
 */

import {
  buildChecks,
  judge,
  localBaseUrl,
  type SmokeCheck,
  type SmokeIds,
  type SmokeVerdict,
} from "./lib/smoke-checks";

// La première compilation d'une page par `next dev` peut prendre longtemps.
const TIMEOUT_MS = 120_000;
// Écoles essayées pour trouver un programme ; l'API v1 est limitée à 60
// requêtes par minute et par IP (proxy.ts).
const MAX_SCHOOLS_TRIED = 10;

const SIGNS = { ok: "✓", absent: "·", fail: "✗", skipped: "–" } as const;

async function call(base: URL, path: string): Promise<{ status: number; contentType: string; text: string; ms: number }> {
  const started = Date.now();
  const res = await fetch(new URL(path, base), { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "manual" });
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    text: await res.text(),
    ms: Date.now() - started,
  };
}

function report(check: SmokeCheck, verdict: SmokeVerdict | "skipped", ms?: number) {
  const sign = verdict === "skipped" ? SIGNS.skipped : SIGNS[verdict.outcome];
  const detail = verdict === "skipped" ? `sauté : ${check.skipped}` : (verdict.detail ?? "");
  const time = ms === undefined ? "" : `${ms} ms`;
  console.log(`  ${sign} ${(check.path ?? check.route).padEnd(64)} ${time.padStart(8)}  ${detail}`);
}

/** Lit un JSON de l'API v1 pour choisir les identifiants ; lève si la réponse n'est pas bonne. */
async function readJson(base: URL, path: string): Promise<unknown> {
  const res = await call(base, path);
  if (res.status !== 200) throw new Error(`${path} : HTTP ${res.status} pendant le choix de l'école.`);
  return JSON.parse(res.text);
}

async function chooseIds(base: URL): Promise<SmokeIds> {
  const { data: schools } = (await readJson(base, "/api/v1/schools?limit=100")) as { data: { id: string; name: string }[] };
  if (schools.length === 0) throw new Error("Aucune école ACTIVE : la base est-elle vide ?");

  for (const school of schools.slice(0, MAX_SCHOOLS_TRIED)) {
    const programs = (await readJson(base, `/api/v1/schools/${school.id}/programs`)) as { id: string }[];
    if (programs.length === 0) continue;
    const campuses = (await readJson(base, `/api/v1/schools/${school.id}/campuses`)) as { id: string }[];
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
  let ids: SmokeIds;
  try {
    ids = await chooseIds(base);
  } catch (error) {
    const reason = (error as Error).name === "TypeError" ? `${base.origin} ne répond pas : npm run dev est-il lancé ?` : (error as Error).message;
    console.error(`✗ ${reason}`);
    return 1;
  }

  const counts = { ok: 0, absent: 0, fail: 0, skipped: 0 };
  for (const check of buildChecks(ids)) {
    if (check.path === null) {
      counts.skipped++;
      report(check, "skipped");
      continue;
    }
    let verdict: SmokeVerdict;
    let ms: number | undefined;
    try {
      const res = await call(base, check.path);
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
