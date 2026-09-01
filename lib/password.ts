/**
 * lib/password.ts — Politique de mot de passe partagée
 *
 * Source unique de vérité pour les contraintes appliquées à tout mot de passe
 * entrant : seed, création de compte, changement de mot de passe.
 *
 * La borne haute est dictée par bcrypt, qui ignore silencieusement tout octet
 * au-delà du 72e. Sans ce contrôle, deux mots de passe distincts partageant
 * leurs 72 premiers octets seraient interchangeables à la connexion.
 */

/** Longueur minimale exigée pour tout nouveau mot de passe. */
export const MIN_PASSWORD_LENGTH = 12;

/** Longueur maximale utile : au-delà, bcrypt tronque sans avertir. */
export const MAX_PASSWORD_BYTES = 72;

/**
 * Valide un mot de passe candidat.
 * @returns le message d'erreur à renvoyer à l'appelant, ou null si valide.
 */
export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) {
    return "Mot de passe requis.";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    return `Le mot de passe ne peut pas dépasser ${MAX_PASSWORD_BYTES} octets (limite bcrypt).`;
  }
  return null;
}
