/**
 * lib/internal-api.ts — Joindre le backend FastAPI local depuis Next.js
 *
 * ## Où est le backend
 *
 * Le backend n'est plus hébergé : l'admin le lance sur son poste, et seul le
 * Next.js de ce poste le connaît par `FASTAPI_URL` (plan backend-local). Le
 * site en ligne (Vercel) n'a ni `FASTAPI_URL` ni jeton. Il n'y a plus de repli
 * sur `localhost:8000` : en ligne, ce repli faisait attendre 4 s chaque appel,
 * puis l'écran annonçait un « Cold Start » (défaut F5).
 *
 * `backendTarget()` dit, avant tout appel réseau, si le backend est joignable
 * et sinon pourquoi : `BACKEND_LOCAL_ONLY` (pas d'URL) ou `TOKEN_MISSING`
 * (URL sans jeton : on n'envoie jamais `Bearer null`). `relayToBackend()`
 * s'en sert pour les routes qui relaient le backend.
 *
 * ## Le jeton
 *
 * Le même secret portait trois noms de part et d'autre de la même frontière de
 * confiance : Next.js envoyait `FASTAPI_INTERNAL_TOKEN`, FastAPI attendait
 * `INTERNAL_API_TOKEN` ou `INTERNAL_TOKEN`. Rien ne le documentait, et une
 * configuration incomplète se traduisait par un 401 sans explication.
 *
 * Nom canonique retenu : INTERNAL_API_TOKEN — celui que FastAPI lit en premier.
 * L'ancien nom reste accepté pour ne casser aucun déploiement existant.
 *
 * Module serveur seulement : l'écran lit les codes d'erreur dans
 * lib/backend-state.ts.
 */

import { NextResponse } from "next/server";

import type { BackendErrorCode } from "@/lib/backend-state";

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

/** URL du backend FastAPI local, sans barre finale ; null si `FASTAPI_URL` est absente. */
export function fastapiUrl(): string | null {
  const url = process.env.FASTAPI_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

export type BackendTarget =
  | { ok: true; url: string; token: string }
  | { ok: false; code: "BACKEND_LOCAL_ONLY" | "TOKEN_MISSING" };

/** Le backend à joindre, ou la raison pour laquelle on ne le joint pas. */
export function backendTarget(): BackendTarget {
  const url = fastapiUrl();
  if (!url) return { ok: false, code: "BACKEND_LOCAL_ONLY" };
  const token = internalApiToken();
  if (!token) return { ok: false, code: "TOKEN_MISSING" };
  return { ok: true, url, token };
}

/**
 * Délai d'attente du backend, par route. `duePasses` couvre la synchro
 * `/usage` qu'une passe réelle fait avant de répondre (20 s au plus), plus la
 * planification (lectures en base, à travers le pont WebSocket en local).
 * `status` reste sous deux rafraîchissements de l'écran (5 s chacun).
 */
export const BACKEND_TIMEOUTS_MS = {
  status: 8_000,
  trigger: 30_000,
  duePasses: 60_000,
} as const;

function relayError(status: number, code: BackendErrorCode, error: string): NextResponse {
  return NextResponse.json({ error, code }, { status });
}

/** La réponse d'une route qui ne peut pas joindre le backend, sans appel réseau. */
export function backendUnavailable(code: "BACKEND_LOCAL_ONLY" | "TOKEN_MISSING"): NextResponse {
  if (code === "BACKEND_LOCAL_ONLY") {
    return relayError(
      503,
      code,
      "Les recherches se pilotent depuis le poste local : ce serveur n'a pas de backend (FASTAPI_URL absente)."
    );
  }
  return relayError(
    500,
    code,
    `${INTERNAL_TOKEN_VAR} absente : posez-la dans .env.local, avec la même valeur que dans backend/.env.`
  );
}

export interface RelayOptions {
  method?: "GET" | "POST";
  /** Corps envoyé en JSON. */
  body?: unknown;
  timeoutMs: number;
  /**
   * Vrai si l'appel peut avoir lancé quelque chose côté backend : un délai
   * dépassé ne prouve alors pas que rien n'est parti, et le message le dit.
   */
  mayHaveStarted?: boolean;
}

/** Code d'erreur réseau de Node (`ECONNREFUSED`…), sans le reste du message. */
function networkCode(err: unknown): string {
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === "string" ? cause.code : "erreur réseau";
}

/**
 * Relaie un appel vers `path` sur le backend local, avec le jeton interne.
 *
 * - Pas d'URL ou pas de jeton : la réponse de `backendUnavailable`, sans appel.
 * - Connexion impossible : 503 `BACKEND_NOT_RUNNING`.
 * - Délai dépassé : 504 `BACKEND_TIMEOUT`.
 * - Corps illisible : 502 `BACKEND_BAD_RESPONSE`.
 * - Sinon, la réponse du backend **telle quelle** : statut et corps JSON, y
 *   compris ses refus (401, 409, 422, 503…), que l'écran sait lire
 *   (lib/backend-state.ts).
 */
export async function relayToBackend(path: string, options: RelayOptions): Promise<NextResponse> {
  const target = backendTarget();
  if (!target.ok) return backendUnavailable(target.code);

  const { method = "GET", body, timeoutMs, mayHaveStarted = false } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let status: number;
  let text: string;
  try {
    const res = await fetch(`${target.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${target.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    status = res.status;
    text = await res.text();
  } catch (err) {
    if (controller.signal.aborted) {
      const seconds = Math.round(timeoutMs / 1000);
      return relayError(
        504,
        "BACKEND_TIMEOUT",
        mayHaveStarted
          ? `Le backend n'a pas répondu en ${seconds} s. La demande a pu partir : ` +
              "consultez l'historique avant de relancer."
          : `Le backend n'a pas répondu en ${seconds} s.`
      );
    }
    return relayError(
      503,
      "BACKEND_NOT_RUNNING",
      `Backend local injoignable (${networkCode(err)}) : est-il lancé ?`
    );
  } finally {
    clearTimeout(timer);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return relayError(502, "BACKEND_BAD_RESPONSE", `Réponse illisible du backend (HTTP ${status}).`);
  }
  return NextResponse.json(data, { status });
}
