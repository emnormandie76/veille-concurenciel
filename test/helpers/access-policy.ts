/**
 * test/helpers/access-policy.ts — L'accès attendu de chaque route du back-office
 *
 *     import { expectedLevel, adminRouteFiles } from "../helpers/access-policy";
 *
 * Une seule table pour les deux tests qui la vérifient :
 * - test/api/admin-guards.test.ts lit le code (chaque handler attend la garde
 *   de son niveau, et une seule) ;
 * - test/api/access-matrix.test.ts appelle chaque handler sous chaque rôle
 *   (aucune session, USER, GESTIONNAIRE, ADMIN), avec la vraie lib/auth.ts.
 *
 * Règles (plan gestion-contenu, étapes 1 et 2 ; décisions G4, G5, D4, D18,
 * D19, D21) :
 * - `admin` : l'IA (backend, historique des jobs, tous les tickets de
 *   l'inbox : ils viennent du pipeline ou passent par lui) et les comptes
 *   (liste blanche, rôles, remise en première connexion, désactivation,
 *   adresse d'un compte ancien) ;
 * - `signedIn` : ce que chacun fait pour soi, sur « Mon compte » : son nom
 *   affiché et son mot de passe. Ces routes ne prennent pas d'identifiant ;
 *   personne ne fixe plus le mot de passe d'un tiers (D4) ;
 * - `manager` : tout le reste, c'est-à-dire la lecture et l'écriture du
 *   contenu, création et suppressions d'école, de campus et de programme
 *   comprises (D19).
 *
 * Toute route ajoutée sous app/api/admin tombe en `manager` par défaut : le
 * test statique exige alors `guardManager`, ce qui ferme l'accès aux USER.
 * Toute modification se reporte dans docs/architecture/gestion-contenu.md §4.
 */

import fs from "node:fs";
import path from "node:path";

export type AccessLevel = "signedIn" | "manager" | "admin";

/** La garde de lib/auth.ts qui porte chaque niveau. */
export const GUARD_OF: Record<AccessLevel, string> = {
  signedIn: "guardSignedIn",
  manager: "guardManager",
  admin: "guardAdmin",
};

/** « MÉTHODE chemin sous app/api/admin » réservés à ADMIN. */
export const ADMIN_ONLY = [
  // IA : appels au backend et historique des jobs
  "GET pipeline-status",
  "GET pipeline-jobs",
  "POST trigger-research",
  "POST run-due-passes",
  // IA : l'inbox, dont tous les tickets viennent du pipeline ou passent par lui
  "GET inbox",
  "GET inbox/[id]",
  "PUT inbox/[id]/validate",
  "PUT inbox/[id]/reject",
  "POST inbox/[id]/create-programs",
  "PUT inbox/[id]/attachments",
  "DELETE inbox/purge",
  // Comptes (étape 2)
  "GET users",
  "POST users",
  "DELETE users/[id]",
  "PATCH users/[id]/role",
  "POST users/[id]/reset",
  "POST users/[id]/disable",
  "PATCH users/[id]/email",
];

/** « MÉTHODE chemin » ouverts à toute session : ce que chacun fait pour soi. */
export const SIGNED_IN = ["PATCH account", "PATCH account/password"];

export function expectedLevel(key: string): AccessLevel {
  if (ADMIN_ONLY.includes(key)) return "admin";
  if (SIGNED_IN.includes(key)) return "signedIn";
  return "manager";
}

export const ADMIN_ROOT = path.join(process.cwd(), "app", "api", "admin");
export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** Chemins des route.ts sous app/api/admin, en `/`, relatifs et triés. */
export function adminRouteFiles(): string[] {
  return fs
    .readdirSync(ADMIN_ROOT, { recursive: true, encoding: "utf-8" })
    .filter((rel) => path.basename(rel) === "route.ts")
    .map((rel) => rel.split(path.sep).join("/"))
    .sort();
}

/** « schools/[id]/route.ts » → « schools/[id] ». */
export const routeKey = (rel: string) => path.posix.dirname(rel);
