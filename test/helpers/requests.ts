/**
 * test/helpers/requests.ts — Requêtes et contextes pour appeler un handler de route
 *
 *     await PUT(body({ name: "Caen" }, "PUT"), params({ id: "c-1" }));
 *     await quietly(() => GET(get("/x"), params({ id: "absent" })));
 */

/** Une requête JSON ; une chaîne est envoyée telle quelle (JSON mal formé). */
export function body(payload: unknown, method = "POST", url = "http://localhost/x"): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

/** Une requête sans corps. */
export function get(url = "http://localhost/x", method = "GET"): Request {
  return new Request(url, { method });
}

/** Le second argument d'un handler Next 16 : `params` est une promesse. */
export function params<P extends Record<string, string>>(values: P): { params: Promise<P> } {
  return { params: Promise.resolve(values) };
}

/** Exécute `fn` sans laisser `console.error` écrire (500 attendus). */
export async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}
