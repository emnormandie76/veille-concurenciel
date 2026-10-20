/**
 * lib/provenance.ts — Qui a modifié une donnée, quand, et d'où elle vient
 *
 * Plan gestion-contenu, étape 5 :
 * - D10 : chaque table de données porte `updated_by_id`, `updated_at` et
 *   `updated_via` (migration 20261019120000_content_provenance). Les lignes
 *   d'avant la migration n'en ont pas : elles restent « non suivies » ;
 * - D11 : une donnée validée depuis l'inbox a pour auteur l'admin qui la
 *   valide, avec l'origine `AI` ; une saisie est `MANUAL` ; `REPORT` attend le
 *   signalement (étape 6). Une écriture qui ne change rien garde l'auteur en
 *   place ;
 * - D25 : « modifié par » montre le nom affiché, quel que soit l'état du
 *   compte, jamais l'adresse ni l'ancien identifiant. Revue le 20 octobre :
 *   une donnée lue par l'API v1 est tenue pour vérifiée, l'API n'en rend que
 *   la date ; le nom et l'origine servent au site et au gestionnaire ;
 * - D29 : le gestionnaire montre le nom et la date de la dernière
 *   modification de chaque donnée, sans l'origine ;
 * - D27 : un lien source saisi est une adresse http(s) de 2 048 caractères au
 *   plus ; à l'affichage, seul un lien http(s) devient cliquable.
 *
 * L'auteur vient toujours de la session relue en base (lib/auth.ts), jamais
 * du corps de la requête. Module sans dépendance, comme lib/roles.ts : routes,
 * pages et tests l'importent tels quels.
 */

// ──────────────────────────────────────────────
// Écrire
// ──────────────────────────────────────────────

/** Les origines d'une modification ; contrainte `CHECK` de la migration. */
export const UPDATE_ORIGINS = ["MANUAL", "AI", "REPORT"] as const;
export type UpdateOrigin = (typeof UPDATE_ORIGINS)[number];

export interface Provenance {
  updated_by_id: string;
  updated_at: Date;
  updated_via: UpdateOrigin;
}

/** La provenance d'une écriture : le compte de la session, l'origine, l'heure du serveur. */
export function provenance(userId: string, via: UpdateOrigin, now: Date = new Date()): Provenance {
  return { updated_by_id: userId, updated_at: now, updated_via: via };
}

/**
 * La branche `update` d'un `upsert`, avec la provenance si elle écrit au moins
 * une valeur. Vide, ou faite de `undefined` (que Prisma ignore), elle reste
 * `{}` : la ligne que l'écriture ne change pas garde son auteur (D11).
 */
export function stampUpdate<T extends Record<string, unknown>>(
  update: T,
  stamp: Provenance
): (T & Provenance) | Record<string, never> {
  return Object.values(update).some((value) => value !== undefined) ? { ...update, ...stamp } : {};
}

// ──────────────────────────────────────────────
// Le lien source (D27)
// ──────────────────────────────────────────────

export const SOURCE_URL_MAX_LENGTH = 2048;
export const SOURCE_URL_ERROR =
  "Le lien source doit être une adresse web (http:// ou https://) de 2 048 caractères au plus. Rien n'a été écrit.";

function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Lit le lien source d'un formulaire. Absent, `null` ou blanc : pas de lien.
 * Une adresse web : la même, sans ses espaces autour. Tout le reste
 * (`javascript:`, `www.…` sans schéma, un nombre…) est refusé, et l'appelant
 * répond 400 avant toute écriture.
 */
export function readSourceUrl(
  raw: unknown
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: SOURCE_URL_ERROR };
  const value = raw.trim();
  if (value === "") return { ok: true, value: null };
  if (value.length > SOURCE_URL_MAX_LENGTH || !isWebUrl(value)) return { ok: false, error: SOURCE_URL_ERROR };
  return { ok: true, value };
}

/**
 * Le lien à mettre dans un `href`, ou `null`. Les liens écrits par la
 * validation de l'inbox ne passent pas par `readSourceUrl` : c'est ici que
 * la fiche se protège.
 */
export function sourceHref(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return isWebUrl(trimmed) ? trimmed : null;
}

// ──────────────────────────────────────────────
// Lire et afficher (D25)
// ──────────────────────────────────────────────

/** Le `select` de l'auteur dans une lecture : son nom affiché, rien d'autre. */
export const AUTHOR_SELECT = { select: { display_name: true } } as const;

/** Ce que l'API v1 lit de la provenance : la date seule (D25, revue le 20 octobre). */
export const API_PROVENANCE_SELECT = { updated_at: true } as const;

export const UNNAMED_AUTHOR = "Compte sans nom";

type Author = { display_name: string | null } | null | undefined;

/** Le nom de l'auteur, sinon « Compte sans nom » ; `null` sans auteur. */
export function authorName(author: Author): string | null {
  if (!author) return null;
  return author.display_name?.trim() || UNNAMED_AUTHOR;
}

const DATE_PARTS = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Paris",
});

/** « 19 octobre 2026 », à l'heure de Paris ; « 1er » pour le premier du mois. */
export function formatProvenanceDate(date: Date | string): string {
  return DATE_PARTS.formatToParts(new Date(date))
    .map((part) => (part.type === "day" && part.value === "1" ? "1er" : part.value))
    .join("");
}

export interface ProvenanceFields {
  updated_at: Date | string | null;
  updated_via: string | null;
  updatedBy?: Author;
}

/**
 * « Modifié par Camille Martin le 19 octobre 2026 », « Validé par … depuis une
 * recherche IA », « … après un signalement » ; `null` pour une ligne d'avant
 * le suivi.
 */
export function describeProvenance(row: ProvenanceFields): string | null {
  if (!row.updated_at) return null;
  const date = formatProvenanceDate(row.updated_at);
  const name = authorName(row.updatedBy);
  const who = name ? ` par ${name}` : "";
  switch (row.updated_via) {
    case "AI":
      return `Validé${who} le ${date}, depuis une recherche IA`;
    case "REPORT":
      return `Modifié${who} le ${date}, après un signalement`;
    default:
      return `Modifié${who} le ${date}`;
  }
}

type Displayed<T> = Omit<T, "updatedBy" | "updated_by_id"> & {
  provenance: string | null;
  source_href: string | null;
};

/**
 * Ce qu'une fiche reçoit d'une ligne : sa provenance en toutes lettres et son
 * lien cliquable, sans l'identifiant ni la relation de l'auteur (rien de plus
 * que son nom ne part vers le navigateur).
 */
export function forDisplay<
  T extends ProvenanceFields & { updated_by_id?: string | null; source_url?: string | null },
>(row: T): Displayed<T> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { updatedBy, updated_by_id, ...rest } = row;
  return { ...rest, provenance: describeProvenance(row), source_href: sourceHref(row.source_url) };
}

// ──────────────────────────────────────────────
// Le gestionnaire (D29)
// ──────────────────────────────────────────────

/**
 * « Modifié par Camille Martin le 19 octobre 2026 » : le nom et la date, quelle
 * que soit l'origine ; `null` pour une ligne d'avant le suivi.
 */
export function describeLastEdit(row: { updated_at: Date | string | null; updatedBy?: Author }): string | null {
  if (!row.updated_at) return null;
  const name = authorName(row.updatedBy);
  return `Modifié${name ? ` par ${name}` : ""} le ${formatProvenanceDate(row.updated_at)}`;
}

type Managed<T> = Omit<T, "updatedBy" | "updated_by_id" | "updated_via"> & { last_edit: string | null };

/**
 * Ce qu'un écran du gestionnaire reçoit d'une ligne : sa dernière
 * modification en toutes lettres (`last_edit`), sans l'identifiant ni la
 * relation de l'auteur, ni l'origine.
 */
export function forManager<
  T extends { updated_at: Date | string | null; updatedBy?: Author; updated_by_id?: string | null; updated_via?: string | null },
>(row: T): Managed<T> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { updatedBy, updated_by_id, updated_via, ...rest } = row;
  return { ...rest, last_edit: describeLastEdit(row) };
}
