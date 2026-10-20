/**
 * lib/content-reports.ts — Le signalement d'une information
 *
 * Plan gestion-contenu, étape 6 (G8 : la contribution du public est remplacée
 * par un formulaire de signalement, sans IA) :
 * - D13 : les signalements ont leur table, `ContentReport` (migration
 *   20261020120000_content_reports), jamais `ContributionInbox`, que le
 *   backend gelé lit et paie (piège 6) ;
 * - toute session signale, USER compris (G4) ; l'auteur vient de la session
 *   relue en base (lib/auth.ts), jamais du corps de la requête ;
 * - D31 : les gestionnaires les lisent sur /admin/reports, les traitent ou
 *   les rejettent, avec un lien vers l'onglet de gestion de la catégorie ;
 * - D32 : traiter un signalement ne date aucune donnée ; une correction reste
 *   `MANUAL` (lib/provenance.ts) ;
 * - D34 : le lien facultatif suit la règle D27 (`readSourceUrl`) ; aucun
 *   serveur ne l'ouvre ;
 * - D35 : 10 signalements par heure et par compte ;
 * - D36 : l'auteur suit les siens sur « Mon compte » : état et réponse ;
 * - D37 : un campus ou un programme supprimé laisse le signalement à l'école,
 *   avec le nom gardé à l'envoi ;
 * - D39 : le gestionnaire voit le nom affiché de l'auteur, jamais son adresse.
 *
 * Module sans dépendance hors lib/provenance.ts, elle-même sans dépendance :
 * routes, pages et tests l'importent tels quels. La migration tient les mêmes
 * listes et bornes (test/content-reports-migration.test.ts).
 */

import { authorName, formatProvenanceDate, readSourceUrl, sourceHref } from "@/lib/provenance";

// ──────────────────────────────────────────────
// Listes de référence (contraintes CHECK de la migration)
// ──────────────────────────────────────────────

export const REPORT_CATEGORIES = [
  "SCHOOL_INFO",
  "CAMPUS_PROGRAM",
  "PRICING",
  "CAPACITY",
  "RANKING",
  "STATS",
  "ACCREDITATION",
  "OTHER",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ReportCategory, string> = {
  SCHOOL_INFO: "Informations de l'école",
  CAMPUS_PROGRAM: "Campus et programmes",
  PRICING: "Tarifs",
  CAPACITY: "Places",
  RANKING: "Classements",
  STATS: "Chiffres clés",
  ACCREDITATION: "Accréditations",
  OTHER: "Autre",
};

/** Les onglets de l'écran de gestion d'une école (app/admin/schools/[id]/manage). */
export type ManageTab = "info" | "accreditations" | "stats" | "campus-programs" | "pricing" | "rankings" | "capacities";

/** L'onglet où se corrige chaque catégorie ; « Autre » ouvre les informations. */
export const CATEGORY_TABS: Record<ReportCategory, ManageTab> = {
  SCHOOL_INFO: "info",
  CAMPUS_PROGRAM: "campus-programs",
  PRICING: "pricing",
  CAPACITY: "capacities",
  RANKING: "rankings",
  STATS: "stats",
  ACCREDITATION: "accreditations",
  OTHER: "info",
};

export const REPORT_STATUSES = ["OPEN", "RESOLVED", "REJECTED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const STATUS_LABELS: Record<ReportStatus, string> = {
  OPEN: "En attente",
  RESOLVED: "Traité",
  REJECTED: "Rejeté",
};

/** Ce que vise un signalement : l'école entière, un de ses campus ou un de ses programmes. */
export const TARGET_TYPES = ["SCHOOL", "CAMPUS", "PROGRAM"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export function isReportCategory(value: unknown): value is ReportCategory {
  return typeof value === "string" && (REPORT_CATEGORIES as readonly string[]).includes(value);
}

function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === "string" && (REPORT_STATUSES as readonly string[]).includes(value);
}

// ──────────────────────────────────────────────
// Bornes et plafond (D35)
// ──────────────────────────────────────────────

export const MESSAGE_MIN_LENGTH = 10;
export const MESSAGE_MAX_LENGTH = 2000;
export const RESPONSE_MAX_LENGTH = 1000;

/** 10 signalements par heure et par compte : l'équipe sort par la même IP. */
export const REPORT_RATE_LIMIT = 10;
export const REPORT_RATE_WINDOW_MS = 60 * 60 * 1000;

/** Le seau du plafond (lib/rate-limit.ts) : le compte de la session. */
export function reportRateKey(userId: string): string {
  return `report:${userId}`;
}

/**
 * La longueur d'un texte comptée comme `char_length` de Postgres, en
 * caractères, et non en unités UTF-16 comme `.length` : sans cela, cinq
 * émojis passaient pour dix caractères ici et cinq en base, et la contrainte
 * refusait l'écriture (500).
 */
export function textLength(value: string): number {
  return [...value].length;
}

// ──────────────────────────────────────────────
// Lire un envoi, lire une décision
// ──────────────────────────────────────────────

type Read<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export const MESSAGE_ERROR = `Décrivez l'information à corriger, en ${MESSAGE_MIN_LENGTH} à 2 000 caractères. Rien n'a été envoyé.`;
const TARGET_ERROR =
  "Un signalement vise l'école, un de ses campus ou un de ses programmes : un seul à la fois. Rien n'a été envoyé.";

export interface ReportInput {
  schoolId: string;
  campusId: string | null;
  programId: string | null;
  category: ReportCategory;
  message: string;
  source_url: string | null;
}

/** Un identifiant facultatif : absent ou vide → `null` ; une chaîne → la même ; le reste → `false`. */
function readId(raw: unknown): string | null | false {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || raw.trim() === "") return false;
  return raw.trim();
}

/**
 * Lit le corps d'un envoi. Seuls ces champs sont lus : l'auteur, l'état, le
 * nom de la cible et le traitement ne viennent jamais du corps.
 */
export function readReport(body: Record<string, unknown>): Read<ReportInput> {
  const schoolId = readId(body.schoolId);
  if (!schoolId) return fail("L'école du signalement manque. Rien n'a été envoyé.");

  const campusId = readId(body.campusId);
  const programId = readId(body.programId);
  if (campusId === false || programId === false || (campusId && programId)) return fail(TARGET_ERROR);

  if (!isReportCategory(body.category)) return fail("Choisissez une catégorie dans la liste. Rien n'a été envoyé.");

  if (typeof body.message !== "string") return fail(MESSAGE_ERROR);
  const message = body.message.trim();
  const length = textLength(message);
  if (length < MESSAGE_MIN_LENGTH || length > MESSAGE_MAX_LENGTH) return fail(MESSAGE_ERROR);

  const source = readSourceUrl(body.source_url);
  if (!source.ok) return fail(source.error);

  return { ok: true, value: { schoolId, campusId, programId, category: body.category, message, source_url: source.value } };
}

export type ReportDecision = Exclude<ReportStatus, "OPEN">;

/** Lit la décision d'un gestionnaire : traité ou rejeté, avec une réponse facultative. */
export function readDecision(body: Record<string, unknown>): Read<{ status: ReportDecision; response: string | null }> {
  const status = body.status;
  if (!isReportStatus(status) || status === "OPEN") {
    return fail("Indiquez si le signalement est traité ou rejeté. Rien n'a été écrit.");
  }
  const raw = body.response;
  if (raw === undefined || raw === null) return { ok: true, value: { status, response: null } };
  if (typeof raw !== "string") return fail("La réponse doit être un texte. Rien n'a été écrit.");
  const response = raw.trim();
  if (textLength(response) > RESPONSE_MAX_LENGTH) {
    return fail("La réponse ne doit pas dépasser 1 000 caractères. Rien n'a été écrit.");
  }
  return { ok: true, value: { status, response: response === "" ? null : response } };
}

// ──────────────────────────────────────────────
// Afficher
// ──────────────────────────────────────────────

interface TargetFields {
  target_type: string;
  target_label: string;
  campusId: string | null;
  programId: string | null;
}

/**
 * « Programme « PGE » », « Campus « Caen » (supprimé) », « L'école » : le nom
 * gardé à l'envoi, et la mention « supprimé » quand la cible n'existe plus
 * (D37 : la clé est passée à vide).
 */
export function describeTarget(row: TargetFields): string {
  switch (row.target_type) {
    case "CAMPUS":
      return `Campus « ${row.target_label} »${row.campusId ? "" : " (supprimé)"}`;
    case "PROGRAM":
      return `Programme « ${row.target_label} »${row.programId ? "" : " (supprimé)"}`;
    default:
      return "L'école";
  }
}

/** Le lien vers l'onglet de gestion de la catégorie ; « Infos » pour une catégorie inconnue. */
export function manageHref(schoolId: string, category: string): string {
  const tab = isReportCategory(category) ? CATEGORY_TABS[category] : "info";
  return `/admin/schools/${encodeURIComponent(schoolId)}/manage?tab=${tab}`;
}

function categoryLabel(category: string): string {
  return isReportCategory(category) ? CATEGORY_LABELS[category] : category;
}

function statusLabel(status: string): string {
  return isReportStatus(status) ? STATUS_LABELS[status] : status;
}

const dateLabel = (date: Date | string | null): string | null => (date ? formatProvenanceDate(date) : null);

type Author = { display_name: string | null } | null;

/** Ce que la vue des gestionnaires lit d'un signalement : l'auteur par son nom seul (D39). */
export const MANAGER_REPORT_SELECT = {
  id: true,
  schoolId: true,
  campusId: true,
  programId: true,
  target_type: true,
  target_label: true,
  category: true,
  message: true,
  source_url: true,
  status: true,
  response: true,
  created_at: true,
  handled_at: true,
  school: { select: { name: true } },
  author: { select: { display_name: true } },
  handledBy: { select: { display_name: true } },
} as const;

export interface ManagerReportRow extends TargetFields {
  id: string;
  schoolId: string;
  category: string;
  message: string;
  source_url: string | null;
  status: string;
  response: string | null;
  created_at: Date | string;
  handled_at: Date | string | null;
  school: { name: string };
  author: Author;
  handledBy: Author;
}

export interface ManagerReport {
  id: string;
  school: { id: string; name: string };
  target: string;
  category_label: string;
  message: string;
  source_href: string | null;
  status: string;
  status_label: string;
  response: string | null;
  author: string | null;
  handled_by: string | null;
  created_label: string | null;
  handled_label: string | null;
  manage_href: string;
}

/**
 * Ce que reçoit la vue des gestionnaires : le texte prêt à poser, le lien
 * cliquable s'il est en http(s), les noms affichés ; aucun identifiant de
 * compte, aucune adresse.
 */
export function forReportManager(row: ManagerReportRow): ManagerReport {
  return {
    id: row.id,
    school: { id: row.schoolId, name: row.school.name },
    target: describeTarget(row),
    category_label: categoryLabel(row.category),
    message: row.message,
    source_href: sourceHref(row.source_url),
    status: row.status,
    status_label: statusLabel(row.status),
    response: row.response,
    author: authorName(row.author),
    handled_by: authorName(row.handledBy),
    created_label: dateLabel(row.created_at),
    handled_label: dateLabel(row.handled_at),
    manage_href: manageHref(row.schoolId, row.category),
  };
}

/** Ce que « Mon compte » lit de ses signalements (D36) : ni le nom du gestionnaire, ni le sien. */
export const AUTHOR_REPORT_SELECT = {
  id: true,
  schoolId: true,
  campusId: true,
  programId: true,
  target_type: true,
  target_label: true,
  category: true,
  status: true,
  response: true,
  created_at: true,
  handled_at: true,
  school: { select: { name: true } },
} as const;

export interface AuthorReportRow extends TargetFields {
  id: string;
  category: string;
  status: string;
  response: string | null;
  created_at: Date | string;
  handled_at: Date | string | null;
  school: { name: string };
}

export interface AuthorReport {
  id: string;
  school_name: string;
  target: string;
  category_label: string;
  status: string;
  status_label: string;
  response: string | null;
  created_label: string | null;
  handled_label: string | null;
}

export function forReportAuthor(row: AuthorReportRow): AuthorReport {
  return {
    id: row.id,
    school_name: row.school.name,
    target: describeTarget(row),
    category_label: categoryLabel(row.category),
    status: row.status,
    status_label: statusLabel(row.status),
    response: row.response,
    created_label: dateLabel(row.created_at),
    handled_label: dateLabel(row.handled_at),
  };
}
