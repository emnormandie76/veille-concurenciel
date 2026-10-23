/**
 * lib/login-attempts.ts — Le plafond de la connexion : les échecs seuls (plan gestion-contenu, D117)
 *
 * Jusqu'au 23 octobre 2026, le proxy plafonnait la connexion et la première
 * connexion à 5 envois par IP et par quart d'heure, réussites comprises :
 * l'équipe sortant par une seule IP, la sixième connexion de l'école était
 * refusée. Décision du propriétaire (D117) : seuls les échecs comptent, sur
 * deux compteurs.
 * - **Par compte** (l'adresse saisie, ou l'ancien identifiant) : 5 échecs
 *   bloquent ce compte, et lui seul, d'où que vienne la connexion ;
 * - **par IP** : 20 échecs, toutes adresses confondues, bloquent l'IP : un
 *   attaquant qui essaie beaucoup d'adresses s'arrête, l'école n'atteint pas
 *   ce seuil par mégarde ;
 * - le blocage dure 15 minutes depuis le premier échec ; une réussite efface
 *   le compteur de son compte, pas celui de l'IP.
 *
 * Le proxy ne voit pas l'issue d'une connexion : la connexion
 * (`authorizeCredentials`, lib/sign-in.ts) et la première connexion
 * (app/api/first-login) consultent et nourrissent ces compteurs, qu'elles
 * partagent ; un compte ou une IP bloqués y sont refusés avant toute lecture
 * en base et avant bcrypt. Les compteurs vivent dans lib/rate-limit.ts, seule
 * limitation de débit du projet.
 *
 * Risque accepté : qui connaît l'adresse d'un collègue peut bloquer sa
 * connexion 15 minutes en échouant 5 fois.
 */

import { clearFailures, clientIp, failureCount, recordFailure } from "@/lib/rate-limit";

// L'erreur et le message du blocage vivent dans lib/roles.ts, sans dépendance,
// pour la page de connexion (un composant client).
export { LOGIN_BLOCKED, LOGIN_BLOCKED_MESSAGE } from "@/lib/roles";

/** Les échecs qui bloquent un compte. */
export const LOGIN_FAILURES_PER_ACCOUNT = 5;
/** Les échecs qui bloquent une IP, toutes adresses confondues. */
export const LOGIN_FAILURES_PER_IP = 20;
/** La durée du blocage, depuis le premier échec. */
export const LOGIN_BLOCK_MS = 15 * 60 * 1000;

/** Le compteur d'un compte : l'identifiant tel que la connexion le lit (casse et espaces ne comptent pas). */
const accountKey = (login: string) => `login-fail:account:${login.trim().toLowerCase()}`;
const ipKey = (ip: string) => `login-fail:ip:${ip}`;

/** Le compte ou l'IP ont-ils atteint leur plafond d'échecs ? */
export async function loginBlocked(login: string, ip: string): Promise<boolean> {
  const [account, network] = await Promise.all([failureCount(accountKey(login)), failureCount(ipKey(ip))]);
  return account >= LOGIN_FAILURES_PER_ACCOUNT || network >= LOGIN_FAILURES_PER_IP;
}

/** Note un échec, pour le compte et pour l'IP. */
export async function recordLoginFailure(login: string, ip: string): Promise<void> {
  await Promise.all([recordFailure(accountKey(login), LOGIN_BLOCK_MS), recordFailure(ipKey(ip), LOGIN_BLOCK_MS)]);
}

/** Une connexion réussie efface les échecs de son compte. */
export async function clearLoginFailures(login: string): Promise<void> {
  await clearFailures(accountKey(login));
}

/**
 * L'IP de l'appelant, depuis les en-têtes que NextAuth passe à `authorize` en
 * objet simple ; mêmes règles que `clientIp` (les en-têtes de la plateforme
 * d'abord).
 */
export function ipFromHeaders(headers: Record<string, unknown> | undefined): string {
  const known = new Headers();
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (typeof value === "string") known.set(name, value);
  }
  return clientIp(known);
}
