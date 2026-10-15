/**
 * lib/public-schools.ts — Lecture de /api/schools pour la page d'accueil
 *
 * L'accueil affichait « Aucune école trouvée » quand l'API échouait : le
 * `catch` remettait la liste à vide, et l'échec des statistiques était avalé
 * par un `.catch(() => {})` (défaut F6, plan backend-local). Une erreur n'est
 * plus jamais une liste vide : elle devient un message, que la page affiche
 * avec un bouton « Réessayer ».
 *
 * Module pur, sans React : la décision se teste sans navigateur
 * (test/silent-pages.test.ts).
 */

export interface PublicCampus {
  id: string;
  name: string;
  city: string | null;
  programs: { id: string }[];
}

export interface PublicSchool {
  id: string;
  name: string;
  official_domain: string;
  status: string;
  campuses: PublicCampus[];
}

export type SchoolsLoad =
  | { ok: true; schools: PublicSchool[]; total: number }
  | { ok: false; error: string };

export const SCHOOLS_LOAD_ERROR =
  "Les écoles n'ont pas pu être chargées. Réessayez dans un instant.";

/**
 * Lit la réponse de /api/schools. Toute réponse en erreur, ou d'une forme
 * inattendue, est un échec explicite — jamais une liste vide.
 */
export function readSchoolsResponse(httpStatus: number, body: unknown): SchoolsLoad {
  if (httpStatus < 200 || httpStatus >= 300) return { ok: false, error: SCHOOLS_LOAD_ERROR };
  if (!body || typeof body !== "object") return { ok: false, error: SCHOOLS_LOAD_ERROR };

  const { data, pagination } = body as { data?: unknown; pagination?: { total?: unknown } };
  if (!Array.isArray(data) || typeof pagination?.total !== "number") {
    return { ok: false, error: SCHOOLS_LOAD_ERROR };
  }
  return { ok: true, schools: data as PublicSchool[], total: pagination.total };
}

/** Les chiffres du bandeau : écoles (total de l'API), campus, programmes par campus. */
export function summarizeSchools(
  schools: PublicSchool[],
  total: number
): { schools: number; campuses: number; programs: number } {
  let campuses = 0;
  let programs = 0;
  for (const school of schools) {
    campuses += school.campuses.length;
    for (const campus of school.campuses) programs += campus.programs.length;
  }
  return { schools: total, campuses, programs };
}
