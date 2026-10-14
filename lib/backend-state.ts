/**
 * lib/backend-state.ts — Ce que l'écran /admin/cron dit du backend local
 *
 * Le backend FastAPI n'est plus hébergé : il tourne sur le poste de l'admin,
 * à la demande (plan backend-local). Le site en ligne n'a donc **pas** de
 * backend, et `/admin/cron` y montre seulement ce que dit la base. En local,
 * l'écran pilote le backend s'il répond.
 *
 * Les routes qui relaient le backend (`lib/internal-api.ts`) répondent, quand
 * elles ne peuvent pas le joindre, `{ error, code }` avec l'un des codes
 * ci-dessous. L'écran en tire trois états :
 *
 * | Réponse de `GET /api/admin/pipeline-status` | État |
 * |---|---|
 * | 2xx | `ready` : backend prêt (ses `startup_errors` s'affichent à part) |
 * | `BACKEND_LOCAL_ONLY` | `local_only` : pilotage depuis le poste local |
 * | `BACKEND_NOT_RUNNING` | `not_running` : backend local non lancé |
 * | tout le reste | `error`, avec un message en clair |
 *
 * Sans React ni import serveur, pour être lu par l'écran et testé sans
 * serveur (test/backend-state.test.ts).
 */

/** Pourquoi une route Next.js n'a pas pu relayer l'appel au backend. */
export type BackendErrorCode =
  /** `FASTAPI_URL` absente : le site en ligne, qui n'a pas de backend. */
  | "BACKEND_LOCAL_ONLY"
  /** `FASTAPI_URL` posée, mais pas `INTERNAL_API_TOKEN`. */
  | "TOKEN_MISSING"
  /** Le backend ne répond pas à son adresse (connexion refusée…). */
  | "BACKEND_NOT_RUNNING"
  /** Le backend n'a pas répondu dans le délai de la route. */
  | "BACKEND_TIMEOUT"
  /** Le backend a répondu autre chose que du JSON. */
  | "BACKEND_BAD_RESPONSE";

/**
 * La commande qui lance le backend sur le poste, citée par l'écran quand le
 * backend ne répond pas. L'étape 6 du plan la remplace par `npm run local`
 * (décision du propriétaire du 14 octobre 2026 : rien de faux à l'écran entre
 * les deux étapes). Jamais `--host 0.0.0.0`.
 */
export const LOCAL_BACKEND_COMMAND = "backend/.venv/Scripts/python -m uvicorn backend.main:app";

export type BackendState =
  | { kind: "ready" }
  | { kind: "local_only" }
  | { kind: "not_running" }
  | { kind: "error"; message: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** L'état du backend, d'après la réponse de `GET /api/admin/pipeline-status`. */
export function backendState(httpStatus: number, body: unknown): BackendState {
  if (httpStatus >= 200 && httpStatus < 300) return { kind: "ready" };
  const code = asRecord(body)?.code;
  if (code === "BACKEND_LOCAL_ONLY") return { kind: "local_only" };
  if (code === "BACKEND_NOT_RUNNING") return { kind: "not_running" };
  return { kind: "error", message: describeBackendError(httpStatus, body) };
}

/**
 * Le message d'une réponse en erreur, qu'elle vienne de Next.js (`error`) ou
 * du backend relayé tel quel (`detail` de FastAPI : texte, objet
 * `{code, message}`, ou liste d'erreurs de validation en 422).
 */
export function describeBackendError(httpStatus: number, body: unknown): string {
  const record = asRecord(body);
  if (record && typeof record.error === "string") return record.error;

  if (httpStatus === 401) {
    // Une réponse de Next.js porte `error` (traitée plus haut) : un 401 sans
    // `error` vient du backend, qui refuse le jeton.
    return (
      "Le backend refuse le jeton : INTERNAL_API_TOKEN n'a pas la même valeur " +
      "dans .env.local et dans backend/.env."
    );
  }

  const detail = record?.detail;
  if (typeof detail === "string") return detail;
  const detailRecord = asRecord(detail);
  if (detailRecord && typeof detailRecord.message === "string") return detailRecord.message;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => asRecord(item)?.msg)
      .filter((msg): msg is string => typeof msg === "string");
    if (messages.length > 0) return `Requête refusée par le backend : ${messages.join(" ; ")}`;
  }

  return `Erreur du backend (HTTP ${httpStatus})`;
}
