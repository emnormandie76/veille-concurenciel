/**
 * lib/ticket-refresh.ts — Rechargement d'un ticket dans l'inbox
 *
 * Après la création de programmes, l'inbox recharge le ticket pour afficher son
 * JSON à jour. Un échec était ignoré (`catch { /* silently ignore *\/ }`), et
 * une réponse non 2xx aussi : l'admin validait sur des données anciennes sans
 * le savoir (défaut F6, plan backend-local). L'échec devient un message.
 *
 * Module pur, testé sans navigateur (test/silent-pages.test.ts).
 */

export const TICKET_REFRESH_ERROR =
  "Le ticket n'a pas pu être rechargé : les données affichées peuvent être anciennes.";

export type TicketRefresh<T> = { ok: true; ticket: T } | { ok: false; error: string };

/** Le ticket rechargé, ou le message à afficher, avec la raison quand elle est lisible. */
export function readRefreshedTicket<T = Record<string, unknown>>(
  httpStatus: number,
  body: unknown
): TicketRefresh<T> {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;

  if (httpStatus < 200 || httpStatus >= 300) {
    const reason = typeof record?.error === "string" ? record.error : `HTTP ${httpStatus}`;
    return { ok: false, error: `${TICKET_REFRESH_ERROR} (${reason})` };
  }
  if (!record || typeof record.id !== "string") {
    return { ok: false, error: `${TICKET_REFRESH_ERROR} (réponse illisible)` };
  }
  return { ok: true, ticket: record as T };
}
