/**
 * lib/request-body.ts — Lecture des corps de requête des routes admin
 *
 * Corps facultatif de l'inbox (`readOptionalJsonObject`) et nombres
 * facultatifs des formulaires (`readOptionalNumbers`).
 *
 * `validate` et `attachments` acceptent un corps facultatif : les corrections
 * de l'admin, qui priment sur `ai_extracted_json`. Sans corps, ou avec `{}`,
 * le ticket est écrit tel quel.
 *
 * Les deux routes lisaient ce corps par `await request.json()` dans un
 * `catch {}` muet : un corps mal formé passait pour « pas de corps », et la
 * route écrivait le JSON brut de l'IA à la place des corrections, avec un 200
 * (défaut F2, plan backend-local). Un corps présent mais illisible est
 * désormais un refus : l'admin doit savoir que ses corrections n'ont pas été
 * lues.
 */

export type OptionalJsonObject =
  | { ok: true; body: Record<string, unknown> | null }
  | { ok: false; error: string };

/**
 * Lit un corps JSON facultatif, qui doit être un objet.
 *
 * - corps absent ou blanc → `{ ok: true, body: null }` ;
 * - objet JSON → `{ ok: true, body }` (y compris `{}`, que l'appelant lit
 *   comme « tel quel ») ;
 * - JSON mal formé, ou valeur qui n'est pas un objet (`null`, tableau,
 *   nombre, chaîne) → `{ ok: false, error }`.
 */
export async function readOptionalJsonObject(request: Request): Promise<OptionalJsonObject> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, error: "Corps de requête illisible : rien n'a été écrit." };
  }

  if (text.trim() === "") return { ok: true, body: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: "Corps JSON illisible : les corrections n'ont pas été lues, rien n'a été écrit.",
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      error: "Le corps doit être un objet JSON : les corrections n'ont pas été lues, rien n'a été écrit.",
    };
  }

  return { ok: true, body: parsed as Record<string, unknown> };
}

/** Le corps de l'admin s'il porte au moins une clé, sinon `null` (« tel quel »). */
export function adminCorrections(body: Record<string, unknown> | null): Record<string, unknown> | null {
  return body && Object.keys(body).length > 0 ? body : null;
}

// ──────────────────────────────────────────────
// Nombres facultatifs des formulaires admin
// ──────────────────────────────────────────────

export type NumberKind = "int" | "float";

/**
 * Lit les champs numériques facultatifs d'un formulaire admin.
 *
 * Absent, `null` ou chaîne vide → `null`. Sinon `parseInt` (base 10) ou
 * `parseFloat` ; un résultat illisible range le champ dans `invalid`, et
 * l'appelant refuse en 400 avant toute écriture.
 *
 * Jusqu'au 14 octobre 2026, ce `NaN` partait tel quel vers Prisma, qui l'écrit
 * en `NULL` : une faute de frappe effaçait la valeur en base, avec un 200.
 */
export function readOptionalNumbers<K extends string>(
  body: Record<string, unknown>,
  fields: Record<K, NumberKind>
): { values: Record<K, number | null>; invalid: K[] } {
  const values = {} as Record<K, number | null>;
  const invalid: K[] = [];
  for (const field of Object.keys(fields) as K[]) {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === "") {
      values[field] = null;
      continue;
    }
    const parsed = fields[field] === "int" ? parseInt(String(raw), 10) : parseFloat(String(raw));
    if (Number.isNaN(parsed)) invalid.push(field);
    values[field] = Number.isNaN(parsed) ? null : parsed;
  }
  return { values, invalid };
}

/** Le message du 400 pour des champs numériques illisibles. */
export function invalidNumbersMessage(fields: readonly string[]): string {
  return `Valeur non numérique pour : ${fields.join(", ")}. Rien n'a été écrit.`;
}
