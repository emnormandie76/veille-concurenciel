/**
 * lib/roles.ts — Les trois rôles et ce que chacun peut faire
 *
 * Plan gestion-contenu, décision G4 (16 octobre 2026) :
 * - `USER` : toute personne connectée ; consulte le site et l'API ;
 * - `GESTIONNAIRE` (les anciens `MODERATOR`) : ajoute, modifie et supprime le
 *   contenu, dans le back-office ;
 * - `ADMIN` : en plus, gère les comptes et seul utilise l'IA.
 *
 * Module sans dépendance (ni next-auth, ni Prisma) : lib/auth.ts s'en sert pour
 * juger, et le faux de test (test/helpers/session.ts) aussi, pour ne jamais
 * dériver de la vraie règle. La contrainte CHECK de `User.role` (migration
 * 20261016120000_three_roles) tient la même liste en base.
 */

export const USER_ROLES = ["USER", "GESTIONNAIRE", "ADMIN"] as const;

export type UserRole = (typeof USER_ROLES)[number];

/**
 * Niveaux d'accès, du plus large au plus étroit. Chaque route du back-office
 * en choisit un, par sa garde (lib/auth.ts) :
 * - `signedIn` : toute session (`guardSignedIn`) ;
 * - `manager` : gestionnaire ou admin (`guardManager`) ;
 * - `admin` : admin seulement (`guardAdmin`).
 */
export type AccessLevel = "signedIn" | "manager" | "admin";

const LEVEL_ROLES: Record<AccessLevel, readonly UserRole[]> = {
  signedIn: USER_ROLES,
  manager: ["GESTIONNAIRE", "ADMIN"],
  admin: ["ADMIN"],
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

/** Vrai si `role` atteint le niveau `level`. */
export function hasAccess(role: UserRole, level: AccessLevel): boolean {
  return LEVEL_ROLES[level].includes(role);
}

/** Libellés de l'interface. */
export const ROLE_LABELS: Record<UserRole, string> = {
  USER: "Utilisateur",
  GESTIONNAIRE: "Gestionnaire",
  ADMIN: "Administrateur",
};

/** La page de connexion, ouverte sans session. */
export const LOGIN_PATH = "/admin/login";

/**
 * La première connexion (étape 2, G5) : la page et sa route, ouvertes sans
 * session (proxy.ts). La route n'est pas sous /api/auth/*, où tout chemin
 * devient public d'office.
 */
export const FIRST_LOGIN_PATH = "/admin/first-login";
export const FIRST_LOGIN_API = "/api/first-login";

/**
 * Le refus du plafond d'échecs de la connexion (D117, lib/login-attempts.ts) :
 * l'erreur que NextAuth rend à la page de connexion, et le message affiché.
 * Ici, sans dépendance, pour que la page (un composant client) les lise sans
 * embarquer le magasin des compteurs.
 */
export const LOGIN_BLOCKED = "TooManyAttempts";
export const LOGIN_BLOCKED_MESSAGE = "Trop de tentatives de connexion. Réessayez dans quelques minutes.";

/**
 * Où renvoyer une personne connectée qui n'a pas le rôle d'une page : le site
 * pour un USER (il ne voit pas le back-office), les écoles pour les autres.
 */
export function homeFor(role: UserRole): string {
  return hasAccess(role, "manager") ? "/admin/schools" : "/";
}

/** Réponses des gardes, reprises telles quelles par le faux de test. */
export const UNAUTHENTICATED_MESSAGE = "Non authentifié. Veuillez vous connecter.";
export const REFUSAL_MESSAGES: Record<Exclude<AccessLevel, "signedIn">, string> = {
  manager: "Accès refusé. Droits GESTIONNAIRE requis.",
  admin: "Accès refusé. Droits ADMIN requis.",
};
