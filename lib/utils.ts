/**
 * lib/utils.ts — Fonctions utilitaires partagées
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
 * Valeurs par défaut : page=1, limit=20 (ou `defaultLimit`) ; limit plafonné
 * à 100.
 *
 * Une valeur hors bornes est ramenée dans les bornes ; une valeur absente, vide
 * ou non numérique reprend la valeur par défaut. Jusqu'au 14 octobre 2026,
 * `?page=abc` donnait NaN, que Prisma refuse : la route répondait 500.
 */
export function parsePagination(
  searchParams: URLSearchParams,
  defaultLimit: number = 20
): {
  page: number;
  limit: number;
  skip: number;
} {
  const page = Math.max(1, readInteger(searchParams.get("page"), 1));
  const limit = Math.min(
    100,
    Math.max(1, readInteger(searchParams.get("limit"), defaultLimit))
  );
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function readInteger(value: string | null, fallback: number): number {
  const parsed = parseInt(value ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
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
 * Utilisé pour la double confirmation de suppression d'école (DELETE schools/[id], architecture/gestion-contenu.md §4.1)
 */
export function confirmationMatches(
  input: string,
  expected: string
): boolean {
  return input.trim().toLowerCase() === expected.trim().toLowerCase();
}

// ──────────────────────────────────────────────
// Utilitaires CORS pour API v1
// ──────────────────────────────────────────────

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function corsResponse(data: any, init?: ResponseInit) {
  return Response.json(data, {
    ...init,
    headers: {
      ...corsHeaders,
      ...init?.headers,
    },
  });
}

export function corsErrorResponse(message: string, status: number = 400) {
  return Response.json(
    { error: message },
    {
      status,
      headers: corsHeaders,
    }
  );
}


// ──────────────────────────────────────────────
// Sûreté des URLs soumises (crowdsourcing)
// ──────────────────────────────────────────────

/**
 * Normalise une valeur de `School.official_domain` en nom d'hôte comparable.
 *
 * Les valeurs en base ne sont pas homogènes : « em-lyon.com »,
 * « www.em-normandie.com » et même « em-strasbourg.com/fr » cohabitent. On
 * retire le schéma, le chemin, le port, un éventuel « www. » de tête, et on
 * passe en minuscules.
 */
export function normalizeDomain(value: string): string {
  let host = value.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // schéma
  host = host.split("/")[0];                          // chemin
  host = host.split("?")[0].split("#")[0];
  host = host.split("@").pop() ?? host;               // éventuels identifiants
  host = host.split(":")[0];                          // port
  host = host.replace(/^www\./, "");
  return host.replace(/\.$/, "");
}

/**
 * Vrai si l'hôte désigne une ressource interne : boucle locale, plage privée,
 * lien-local, ou nom de domaine non routable.
 *
 * Sans ce contrôle, une URL soumise peut faire interroger par le pipeline des
 * adresses du réseau interne de la plateforme.
 *
 * Un point final (« localhost. », nom pleinement qualifié) et une IPv4
 * encapsulée dans une IPv6 (« ::ffff:127.0.0.1 », que le parseur d'URL réécrit
 * en « ::ffff:7f00:1 ») sont ramenés à leur forme simple avant le contrôle :
 * jusqu'au 14 octobre 2026, ils passaient pour publics.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");

  const mapped = mappedIpv4(host);
  if (mapped) return isPrivateHost(mapped);

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  ) {
    return true;
  }

  // IPv6
  if (host.includes(":")) {
    if (host === "::" || host === "::1") return true;
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // unique local fc00::/7
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // lien-local fe80::/10
    return false;
  }

  // IPv4
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  return false;
}

/**
 * L'IPv4 que porte une adresse IPv6 « mappée » (::ffff:0:0/96), en notation
 * pointée, ou null. Accepte la forme pointée (::ffff:127.0.0.1), la forme
 * hexadécimale que rend le parseur d'URL (::ffff:7f00:1) et la forme longue
 * (0:0:0:0:0:ffff:…).
 */
function mappedIpv4(host: string): string | null {
  const match = host.match(/^(?:::|(?:0{1,4}:){5})ffff:(.+)$/);
  if (!match) return null;
  const tail = match[1];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(tail)) return tail;
  const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

/**
 * Vrai si `url` pointe vers `baseDomain` ou l'un de ses sous-domaines.
 * `baseDomain` est normalisé par `normalizeDomain`.
 */
export function urlBelongsToDomain(url: string, baseDomain: string): boolean {
  const base = normalizeDomain(baseDomain);
  if (!base) return false;
  try {
    const host = normalizeDomain(new URL(url).hostname);
    return host === base || host.endsWith(`.${base}`);
  } catch {
    return false;
  }
}
