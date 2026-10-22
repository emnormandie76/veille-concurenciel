/**
 * lib/contribution.ts — Énumérations de la zone tampon ContributionInbox
 *
 * Les statuts, catégories et types de source circulaient en chaînes libres,
 * dupliqués entre Python et TypeScript, sans liste de référence. Une faute de
 * frappe créait un état inatteignable, en silence : le ticket partait en base
 * avec un statut que plus aucun écran ni aucune requête ne filtrait.
 *
 * Ce fichier est la liste de référence côté TypeScript. Son pendant Python est
 * `backend/constants.py` (branche `local` depuis l'étape 11 du plan
 * gestion-contenu, D101). Les deux sont tenues ensemble par des contraintes
 * CHECK en base (migration 20260902120000_contribution_enum_guards) : c'est la
 * seule frontière que les deux langages partagent réellement, et c'est donc là
 * qu'une valeur inventée doit être refusée.
 *
 * Pourquoi des contraintes CHECK plutôt que des `enum` Prisma : le pipeline
 * Python écrit dans ces colonnes en SQL direct (psycopg2), pas via Prisma. Un
 * type énuméré PostgreSQL comme un CHECK protège les deux chemins d'écriture ;
 * un `enum` Prisma seul n'aurait typé que la moitié TypeScript, et aurait
 * impliqué une conversion de type de colonne pour un gain limité.
 */

/** Statuts d'un ticket ContributionInbox. */
export const CONTRIBUTION_STATUSES = [
  "Pending_AI",
  "Pending_Admin",
  "Validated",
  "Rejected",
  "Failed",
] as const;

export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

/** Statuts terminaux : un ticket qui y est arrivé ne se retraite plus. */
export const TERMINAL_CONTRIBUTION_STATUSES = ["Validated", "Rejected"] as const;

/** Catégories d'extraction. Program_Discovery est produite par la Phase 1. */
export const CONTRIBUTION_CATEGORIES = [
  "Program_Discovery",
  "Pricing",
  "Ranking",
  "Capacity",
  "SchoolStats",
  "Accreditation",
] as const;

export type ContributionCategory = (typeof CONTRIBUTION_CATEGORIES)[number];

/**
 * Catégories qu'un visiteur peut soumettre.
 * Program_Discovery en est exclue : elle n'est produite que par le pipeline.
 */
export const PUBLIC_CONTRIBUTION_CATEGORIES = [
  "Pricing",
  "Ranking",
  "Capacity",
  "SchoolStats",
  "Accreditation",
] as const;

/** Origine d'un ticket. */
export const CONTRIBUTION_SOURCE_TYPES = [
  "User_Submission",
  "Automated_AI",
] as const;

export type ContributionSourceType = (typeof CONTRIBUTION_SOURCE_TYPES)[number];

export function isContributionStatus(value: unknown): value is ContributionStatus {
  return (
    typeof value === "string" &&
    (CONTRIBUTION_STATUSES as readonly string[]).includes(value)
  );
}

export function isContributionCategory(value: unknown): value is ContributionCategory {
  return (
    typeof value === "string" &&
    (CONTRIBUTION_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * Constantes nommées, pour les sites d'appel qui écrivent un statut.
 * Elles évitent la chaîne libre au moment de l'écriture ; la contrainte CHECK
 * en base garde ce que le SQL direct du pipeline Python y écrit.
 */
export const STATUS_PENDING_AI: ContributionStatus = "Pending_AI";
export const STATUS_PENDING_ADMIN: ContributionStatus = "Pending_Admin";
export const STATUS_VALIDATED: ContributionStatus = "Validated";
export const STATUS_REJECTED: ContributionStatus = "Rejected";
export const STATUS_FAILED: ContributionStatus = "Failed";

/**
 * Marque d'un ticket `Program_Discovery` qui ne porte qu'un rapport Research en
 * attente d'extraction : la Phase 1 l'a rangé en `Failed` après un échec Gemini,
 * et sa prochaine passe pour l'école le reprendra sans repayer Research. Même
 * valeur que `PARKED_REPORT_REASON` dans backend/pipeline/phase1_research.py
 * (branche `local`).
 */
export const PARKED_RESEARCH_REPORT = "research_report_parked";

/** Vrai si la charge enregistrée est celle d'un rapport Research rangé. */
export function isParkedResearchReport(json: unknown): boolean {
  return (
    json !== null &&
    typeof json === "object" &&
    !Array.isArray(json) &&
    (json as Record<string, unknown>).parked_reason === PARKED_RESEARCH_REPORT
  );
}
