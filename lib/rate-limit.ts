/**
 * lib/rate-limit.ts — Limitation de débit : implémentation unique du projet
 *
 * Remplace les trois copies divergentes qui coexistaient (ce fichier, `proxy.ts`
 * et une logique en ligne dans la route de contribution, retirée depuis : plan
 * gestion-contenu, D2).
 *
 * Deux magasins :
 *  - **Partagé** (Upstash Redis REST) dès que `UPSTASH_REDIS_REST_URL` et
 *    `UPSTASH_REDIS_REST_TOKEN` sont définis. C'est le seul mode qui limite
 *    réellement sur une plateforme sans état : chaque invocation à froid d'une
 *    fonction Vercel repart sinon d'un compteur vide.
 *  - **Mémoire** sinon. Ralentit une attaque, ne la bloque pas. Suffisant en
 *    développement, insuffisant en production — d'où l'avertissement au premier
 *    usage.
 *
 * Compatible runtime Edge (middleware) : `fetch` uniquement, aucune dépendance.
 */

// ──────────────────────────────────────────────
// Identification de l'appelant
// ──────────────────────────────────────────────

/**
 * Détermine l'IP de l'appelant à partir des en-têtes.
 *
 * L'ordre compte. `x-forwarded-for` est **écrit par le client** : s'y fier seul
 * rendait le plafond contournable en variant sa valeur à chaque requête. Les
 * en-têtes posés par la plateforme sont interrogés d'abord — Vercel écrase
 * `x-vercel-forwarded-for` et `x-real-ip`, un client ne peut pas les forger.
 */
export function clientIp(headers: Headers): string {
  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();

  const real = headers.get("x-real-ip");
  if (real) return real.trim();

  // Dernier recours, hors plateforme reconnue : falsifiable par le client.
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  return "unknown";
}

// ──────────────────────────────────────────────
// Magasin mémoire (repli)
// ──────────────────────────────────────────────

const memoryStore = new Map<string, { count: number; resetTime: number }>();
let memoryWarningIssued = false;

/** Purge les fenêtres expirées : sans cela chaque clé vue reste en mémoire. */
function sweepExpired(now: number): void {
  for (const [key, record] of memoryStore) {
    if (now > record.resetTime) memoryStore.delete(key);
  }
}

function checkInMemory(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (memoryStore.size > 5000) sweepExpired(now);

  const record = memoryStore.get(key);
  if (!record || now > record.resetTime) {
    memoryStore.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  if (record.count >= limit) return false;
  record.count += 1;
  return true;
}

// ──────────────────────────────────────────────
// Magasin partagé (Upstash Redis REST)
// ──────────────────────────────────────────────

function upstashConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

/**
 * INCR puis EXPIRE NX en un aller-retour. La clé porte la fenêtre courante dans
 * son nom, ce qui donne une fenêtre fixe : simple, et suffisant ici.
 *
 * @returns true si la requête est autorisée, null si le magasin est injoignable
 *          (l'appelant décide alors du repli).
 */
async function checkUpstash(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean | null> {
  const cfg = upstashConfig();
  if (!cfg) return null;

  const windowId = Math.floor(Date.now() / windowMs);
  const redisKey = `rl:${key}:${windowId}`;
  const ttlSeconds = Math.ceil(windowMs / 1000);

  try {
    const res = await fetch(`${cfg.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", redisKey],
        ["EXPIRE", redisKey, String(ttlSeconds), "NX"],
      ]),
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(`[rate-limit] Upstash a répondu ${res.status}`);
      return null;
    }

    const payload = (await res.json()) as Array<{ result?: unknown; error?: string }>;
    const count = Number(payload?.[0]?.result);
    if (!Number.isFinite(count)) {
      console.error("[rate-limit] réponse Upstash inattendue");
      return null;
    }
    return count <= limit;
  } catch (error) {
    console.error("[rate-limit] Upstash injoignable:", error);
    return null;
  }
}

// ──────────────────────────────────────────────
// API publique
// ──────────────────────────────────────────────

/**
 * Consomme une unité du quota `key`.
 *
 * @param key      identifiant du seau, préfixé par usage (`login:`, `v1:`, …)
 * @param limit    nombre de requêtes autorisées dans la fenêtre
 * @param windowMs largeur de la fenêtre, en millisecondes
 * @returns true si la requête est autorisée
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const shared = await checkUpstash(key, limit, windowMs);
  if (shared !== null) return shared;

  if (!upstashConfig() && !memoryWarningIssued) {
    memoryWarningIssued = true;
    console.warn(
      "[rate-limit] Aucun magasin partagé configuré (UPSTASH_REDIS_REST_URL / " +
        "UPSTASH_REDIS_REST_TOKEN). Repli mémoire : le plafond est propre à " +
        "chaque instance et ne tient pas sur une plateforme sans état."
    );
  }

  return checkInMemory(key, limit, windowMs);
}

/** Indique si un magasin partagé est actif (diagnostic / page de statut). */
export function isSharedStoreConfigured(): boolean {
  return upstashConfig() !== null;
}
