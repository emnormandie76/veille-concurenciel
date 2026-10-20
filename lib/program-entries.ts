/**
 * lib/program-entries.ts — Les admissions d'un programme : en quelle année on entre, avec quel diplôme
 *
 * Plan gestion-contenu, étape 8 (doc « Plan d'évolution » : « Année d'entrée
 * d'un programme : avec quel diplôme on peut y entrer ») :
 * - D16 : une table fille, `ProgramEntry` (migration
 *   20261020180000_program_entries), une ligne par entrée possible : un
 *   programme en a souvent plusieurs (post-bac en 1re année, Bac+2 en
 *   3e année) ;
 * - D47 : `Program.admission_exam` (le concours, en texte libre) reste tel
 *   quel ; les entrées le complètent ;
 * - D48 : des listes fermées, tenues aussi par les contraintes CHECK de la
 *   migration (test/program-entries-migration.test.ts) ;
 * - D49 : la provenance des neuf tables (lib/provenance.ts) et un lien source
 *   contrôlé par `readSourceUrl` (D27) ; l'auteur vient de la session, jamais
 *   du corps ;
 * - D51 : le texte affiché (« Entrée en 1re année avec le Bac, par
 *   Parcoursup ») vient d'ici, sans style.
 *
 * Module sans dépendance hors lib/provenance.ts et lib/content-reports.ts,
 * eux-mêmes sans dépendance : routes, pages, onglet et tests l'importent tels
 * quels.
 */

import { textLength } from "@/lib/content-reports";
import { API_PROVENANCE_SELECT, readSourceUrl } from "@/lib/provenance";

// ──────────────────────────────────────────────
// Listes de référence (contraintes CHECK de la migration)
// ──────────────────────────────────────────────

/** L'année du programme où l'on entre : 1 à 5. */
export const ENTRY_YEAR_MIN = 1;
export const ENTRY_YEAR_MAX = 5;

/** Le niveau requis : 0 pour le Bac, 1 à 5 pour Bac+1 à Bac+5. */
export const REQUIRED_LEVEL_MIN = 0;
export const REQUIRED_LEVEL_MAX = 5;

/**
 * La voie d'entrée. « Non précisée » est une valeur, et non un vide : sous
 * PostgreSQL deux NULL sont distincts, et l'unique laisserait entrer deux fois
 * la même entrée (comme `ProgramPlacement.study_year`).
 */
export const ENTRY_ROUTES = ["PARCOURSUP", "EXAM", "TITLE", "INTERNATIONAL", "UNSPECIFIED"] as const;
export type EntryRoute = (typeof ENTRY_ROUTES)[number];

export const ROUTE_LABELS: Record<EntryRoute, string> = {
  PARCOURSUP: "Parcoursup",
  EXAM: "Concours",
  TITLE: "Admission sur titre",
  INTERNATIONAL: "Candidats internationaux",
  UNSPECIFIED: "Non précisée",
};

/** La voie dans une phrase ; rien pour une voie non précisée. */
const ROUTE_PHRASES: Record<EntryRoute, string | null> = {
  PARCOURSUP: "par Parcoursup",
  EXAM: "sur concours",
  TITLE: "sur titre",
  INTERNATIONAL: "pour les candidats internationaux",
  UNSPECIFIED: null,
};

/** Le nom du concours, les diplômes acceptés… */
export const NOTE_MAX_LENGTH = 500;

export function isEntryRoute(value: unknown): value is EntryRoute {
  return typeof value === "string" && (ENTRY_ROUTES as readonly string[]).includes(value);
}

/** L'ordre d'affichage : l'année d'entrée, puis le niveau, puis la voie. */
export const ENTRY_ORDER_BY = [{ entry_year: "asc" as const }, { required_level: "asc" as const }, { route: "asc" as const }];

/** Ce que l'API v1 lit d'une entrée : la date seule de la provenance (D25 revue, D53). */
export const ENTRY_API_SELECT = {
  id: true,
  entry_year: true,
  required_level: true,
  route: true,
  note: true,
  source_url: true,
  ...API_PROVENANCE_SELECT,
} as const;

// ──────────────────────────────────────────────
// Afficher
// ──────────────────────────────────────────────

/** « 1re année », « 3e année ». */
export function entryYearLabel(year: number): string {
  return year === 1 ? "1re année" : `${year}e année`;
}

/** « Bac », « Bac+2 ». */
export function levelLabel(level: number): string {
  return level === 0 ? "Bac" : `Bac+${level}`;
}

/** Le libellé d'une voie ; une valeur inconnue reste lisible telle quelle. */
export function routeLabel(route: string): string {
  return isEntryRoute(route) ? ROUTE_LABELS[route] : route;
}

/** « Entrée en 3e année avec un Bac+2, sur concours ». */
export function describeEntry(entry: { entry_year: number; required_level: number; route: string }): string {
  const level = entry.required_level === 0 ? "le Bac" : `un ${levelLabel(entry.required_level)}`;
  const phrase = isEntryRoute(entry.route) ? ROUTE_PHRASES[entry.route] : null;
  return `Entrée en ${entryYearLabel(entry.entry_year)} avec ${level}${phrase ? `, ${phrase}` : ""}`;
}

// ──────────────────────────────────────────────
// Lire un envoi
// ──────────────────────────────────────────────

type Read<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export const DUPLICATE_ENTRY_ERROR =
  "Cette entrée existe déjà pour ce programme (même année, même niveau, même voie). Rien n'a été écrit.";

export interface EntryInput {
  entry_year: number;
  required_level: number;
  route: EntryRoute;
  note: string | null;
  source_url: string | null;
}

/** Un entier, donné en nombre ou en chiffres (un champ de formulaire) ; sinon `null`. */
function readInteger(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) ? raw : null;
  if (typeof raw === "string" && /^\s*-?\d+\s*$/.test(raw)) return Number(raw);
  return null;
}

/**
 * Lit le corps d'un envoi de l'onglet « Admissions ». Seuls ces champs sont
 * lus : ni le programme (il vient de l'URL), ni l'auteur, ni la date, ni
 * l'origine (la session et le serveur les posent).
 */
export function readEntry(body: Record<string, unknown>): Read<EntryInput> {
  const year = readInteger(body.entry_year);
  if (year === null || year < ENTRY_YEAR_MIN || year > ENTRY_YEAR_MAX) {
    return fail("L'année d'entrée doit être une année du programme, de la 1re à la 5e. Rien n'a été écrit.");
  }

  const level = readInteger(body.required_level);
  if (level === null || level < REQUIRED_LEVEL_MIN || level > REQUIRED_LEVEL_MAX) {
    return fail("Le niveau requis doit aller du Bac à Bac+5. Rien n'a été écrit.");
  }

  const rawRoute = body.route;
  const route = rawRoute === undefined || rawRoute === null || rawRoute === "" ? "UNSPECIFIED" : rawRoute;
  if (!isEntryRoute(route)) return fail("Choisissez une voie dans la liste. Rien n'a été écrit.");

  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string") return fail("La note doit être un texte. Rien n'a été écrit.");
    const trimmed = body.note.trim();
    if (textLength(trimmed) > NOTE_MAX_LENGTH) {
      return fail("La note ne doit pas dépasser 500 caractères. Rien n'a été écrit.");
    }
    note = trimmed === "" ? null : trimmed;
  }

  const source = readSourceUrl(body.source_url);
  if (!source.ok) return fail(source.error);

  return { ok: true, value: { entry_year: year, required_level: level, route, note, source_url: source.value } };
}
