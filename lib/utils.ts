/**
 * lib/utils.ts — Fonctions utilitaires partagées (Étape 2)
 *
 * Référence : task.md §2, architecture.md §2.4
 */

// ──────────────────────────────────────────────
// Validation
// ──────────────────────────────────────────────

/**
 * Vérifie qu'une URL commence par https://
 * Edge Case 1 : validation format URL soumissions crowdsourcing
 */
export function isValidHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Extrait les paramètres de pagination depuis les searchParams.
 * Valeurs par défaut : page=1, limit=20
 */
export function parsePagination(searchParams: URLSearchParams): {
  page: number;
  limit: number;
  skip: number;
} {
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10))
  );
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// ──────────────────────────────────────────────
// Réponses d'erreur standardisées
// ──────────────────────────────────────────────

/**
 * Format d'erreur standardisé pour toutes les API Routes.
 * Référence : API-rest.md — format { "error": "description" }
 */
export function errorResponse(message: string, status: number = 400) {
  return Response.json({ error: message }, { status });
}

// ──────────────────────────────────────────────
// Formatage
// ──────────────────────────────────────────────

/**
 * Formate un montant en euros (ex: 12500 → "12 500 €")
 */
export function formatEuros(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Formate une année académique (ex: 2025 → "2025-2026")
 */
export function formatAcademicYear(year: number | null | undefined): string {
  if (year == null) return "—";
  return `${year}-${year + 1}`;
}

// ──────────────────────────────────────────────
// Double confirmation de suppression
// ──────────────────────────────────────────────

/**
 * Vérifie que le nom de confirmation correspond au nom attendu.
 * Utilisé pour la double confirmation de suppression d'école (task.md §2.2)
 */
export function confirmationMatches(
  input: string,
  expected: string
): boolean {
  return input.trim().toLowerCase() === expected.trim().toLowerCase();
}
