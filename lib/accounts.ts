/**
 * lib/accounts.ts — Les comptes de la liste blanche : adresse, nom affiché, état
 *
 * Plan gestion-contenu, étape 2 :
 * - G5 : l'admin ajoute l'adresse de travail d'un collègue, sans envoi
 *   d'e-mail ; à sa première connexion, la personne choisit son mot de passe ;
 * - D5 : seul le domaine `WORK_EMAIL_DOMAIN` est accepté, à l'ajout comme à la
 *   première connexion. L'élargir est une décision du propriétaire ;
 * - D6 : le nom affiché, prérempli depuis `prenom.nom@…` ;
 * - trois états : `INVITED` (sur la liste, pas encore de mot de passe ; aussi
 *   après une remise en première connexion, D4), `ACTIVE`, `DISABLED` (D21).
 *
 * Module sans dépendance (ni Prisma, ni next-auth) : les routes, les écrans et
 * les tests s'en servent. La contrainte CHECK `User_status_check` (migration
 * 20261016150000_whitelist_accounts) tient la même liste d'états en base.
 */

export const ACCOUNT_STATUSES = ["INVITED", "ACTIVE", "DISABLED"] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export function isAccountStatus(value: unknown): value is AccountStatus {
  return typeof value === "string" && (ACCOUNT_STATUSES as readonly string[]).includes(value);
}

/** Libellés de l'interface. */
export const STATUS_LABELS: Record<AccountStatus, string> = {
  INVITED: "Invité",
  ACTIVE: "Actif",
  DISABLED: "Désactivé",
};

// ──────────────────────────────────────────────
// Adresse de travail (D5)
// ──────────────────────────────────────────────

/** Le seul domaine accepté (D5, décision du 16 octobre 2026). */
export const WORK_EMAIL_DOMAIN = "em-normandie.fr";

/** La forme rangée en base : minuscules, sans espaces autour. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Partie locale : lettres, chiffres et . _ + -, sans point en tête, en fin ni
// doublé. Pas d'accent : les adresses de l'établissement n'en ont pas.
const LOCAL_PART = /^[a-z0-9_+-]+(\.[a-z0-9_+-]+)*$/;
const MAX_LOCAL_LENGTH = 64;

export type EmailCheck = { email: string; error: null } | { email: null; error: string };

/** Valide une adresse saisie et la rend sous sa forme rangée en base. */
export function validateWorkEmail(raw: unknown): EmailCheck {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { email: null, error: "Adresse e-mail requise." };
  }
  const email = normalizeEmail(raw);
  const parts = email.split("@");
  if (parts.length !== 2 || parts[1] === "") {
    return { email: null, error: "Adresse e-mail invalide." };
  }
  const [local, domain] = parts;
  if (domain !== WORK_EMAIL_DOMAIN) {
    return { email: null, error: `Seules les adresses @${WORK_EMAIL_DOMAIN} sont acceptées.` };
  }
  if (local.length > MAX_LOCAL_LENGTH || !LOCAL_PART.test(local)) {
    return { email: null, error: "Adresse e-mail invalide." };
  }
  return { email, error: null };
}

// ──────────────────────────────────────────────
// Nom affiché (D6)
// ──────────────────────────────────────────────

export const MIN_DISPLAY_NAME_LENGTH = 2;
export const MAX_DISPLAY_NAME_LENGTH = 80;

const capitalize = (word: string) => (word ? word[0].toUpperCase() + word.slice(1) : word);

/**
 * Le nom proposé à la première connexion : `jean-pierre.dupont@…` donne
 * « Jean-Pierre Dupont ». Ce qui suit un `+` est ignoré.
 */
export function nameFromEmail(email: string): string {
  const local = normalizeEmail(email).split("@")[0].split("+")[0];
  return local
    .split(/[._]+/)
    .filter(Boolean)
    .map((part) => part.split("-").map(capitalize).join("-"))
    .join(" ");
}

export type DisplayNameCheck = { name: string; error: null } | { name: null; error: string };

/** Valide un nom affiché : espaces repliés, bornes, pas de caractère de contrôle. */
export function validateDisplayName(raw: unknown): DisplayNameCheck {
  if (typeof raw !== "string") return { name: null, error: "Nom affiché requis." };
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    return { name: null, error: "Le nom affiché contient des caractères non autorisés." };
  }
  const name = raw.trim().replace(/\s+/g, " ");
  if (name === "") return { name: null, error: "Nom affiché requis." };
  if (name.length < MIN_DISPLAY_NAME_LENGTH) {
    return { name: null, error: `Le nom affiché doit faire au moins ${MIN_DISPLAY_NAME_LENGTH} caractères.` };
  }
  if (name.length > MAX_DISPLAY_NAME_LENGTH) {
    return { name: null, error: `Le nom affiché ne peut pas dépasser ${MAX_DISPLAY_NAME_LENGTH} caractères.` };
  }
  return { name, error: null };
}

/**
 * Le nom montré d'un compte : son nom affiché ; à défaut, l'ancien
 * identifiant (compte d'avant la liste blanche, D3) ; à défaut, l'adresse.
 */
export function displayNameOf(account: {
  display_name?: string | null;
  username?: string | null;
  email?: string | null;
}): string {
  return account.display_name || account.username || account.email || "Compte sans nom";
}
