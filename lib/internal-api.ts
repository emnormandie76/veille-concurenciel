/**
 * lib/internal-api.ts — Jeton partagé avec le backend FastAPI
 *
 * Le même secret portait trois noms de part et d'autre de la même frontière de
 * confiance : Next.js envoyait `FASTAPI_INTERNAL_TOKEN`, FastAPI attendait
 * `INTERNAL_API_TOKEN` ou `INTERNAL_TOKEN`. Rien ne le documentait, et une
 * configuration incomplète se traduisait par un 401 sans explication.
 *
 * Nom canonique retenu : INTERNAL_API_TOKEN — celui que FastAPI lit en premier.
 * L'ancien nom reste accepté pour ne casser aucun déploiement existant.
 */

/** Nom de la variable à privilégier dans toute nouvelle configuration. */
export const INTERNAL_TOKEN_VAR = "INTERNAL_API_TOKEN";

/** Ancien nom, toujours accepté côté Next.js. */
const LEGACY_VAR = "FASTAPI_INTERNAL_TOKEN";

let legacyWarningIssued = false;

/**
 * Retourne le jeton d'appel de l'API interne, ou null s'il n'est pas configuré.
 * L'appelant décide du code d'erreur à renvoyer.
 */
export function internalApiToken(): string | null {
  const canonical = process.env[INTERNAL_TOKEN_VAR];
  if (canonical) return canonical;

  const legacy = process.env[LEGACY_VAR];
  if (legacy) {
    if (!legacyWarningIssued) {
      legacyWarningIssued = true;
      console.warn(
        `[internal-api] ${LEGACY_VAR} est obsolète : renommez la variable en ` +
          `${INTERNAL_TOKEN_VAR}, le nom attendu par FastAPI.`
      );
    }
    return legacy;
  }

  return null;
}

/** URL du backend FastAPI, avec le repli de développement. */
export function fastapiUrl(): string {
  return process.env.FASTAPI_URL || "http://localhost:8000";
}
