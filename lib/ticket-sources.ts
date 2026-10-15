/**
 * lib/ticket-sources.ts — Les trois sources d'un ticket du pipeline, à l'écran
 *
 * Reflet de backend/pipeline/ticket_sources.py (décisions du propriétaire du
 * 15 octobre 2026, journal du plan backend-local) : le bloc « Sources » d'un
 * ticket `Automated_AI` porte au plus 3 liens, choisis dans cet ordre, sans
 * doublon :
 *
 *  1. la première page catalogue, en Phase 1 (`priorityUrls`) ;
 *  2. les URL citées par les données (`source_url`, `source_urls`, à toute
 *     profondeur de la charge, dans l'ordre de lecture) ;
 *  3. les autres pages catalogue et les URL du domaine officiel ;
 *  4. le reste, dans l'ordre de Tavily.
 *
 * Le pipeline coupe à l'écriture ; l'inbox plafonne en plus les tickets écrits
 * avant la coupe (`displayedTicketSources`). Les contributions du public ne
 * passent jamais par ici. Doublons : même URL au schéma et à la casse de l'hôte
 * près, à un `www.` de tête de l'hôte près (`essca.eu` cité par l'extraction,
 * `www.essca.eu` donné par Tavily), au fragment et à une `/` finale près ; la
 * première écriture reste.
 * Domaine officiel : l'hôte ou un de ses sous-domaines, jamais une
 * sous-chaîne ; `School.official_domain` est nettoyé (schéma, chemin, port,
 * `www.` de tête). Seul l'ASCII est replié en minuscules, comme en Python.
 *
 * Module pur : la page de l'inbox est un composant client, et ce module entre
 * dans son paquet. `test/fixtures/ticket_sources_cases.json` tient les deux
 * implémentations (test/ticket-sources.test.ts, test/test_ticket_sources.py).
 */

import type { ContributionSourceType } from "@/lib/contribution";

/** Le plafond du bloc « Sources » d'un ticket du pipeline. */
export const MAX_TICKET_SOURCES = 3;

const AUTOMATED_AI: ContributionSourceType = "Automated_AI";

// Schéma http(s), autorité, puis tout le reste.
const URL_RE = /^([Hh][Tt][Tt][Pp][Ss]?):\/\/([^/?#]*)([\s\S]*)$/;
// Un schéma quelconque en tête du domaine officiel.
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
// Les blancs ASCII seulement, comme `str.strip(" \t\n\r\f\v")` côté Python :
// `trim()` en retire d'autres.
const EDGE_BLANKS = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;

const asciiLower = (text: string) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** L'hôte d'un `hôte:port` : sans le port, crochets IPv6 gardés. */
function hostOf(hostport: string): string {
  if (hostport.startsWith("[")) {
    const end = hostport.indexOf("]");
    return end !== -1 ? hostport.slice(0, end + 1) : hostport;
  }
  return hostport.split(":", 1)[0];
}

interface ParsedUrl {
  text: string;
  scheme: string;
  userinfo: string;
  hostport: string;
  rest: string;
}

/** L'URL nettoyée et ses parties, ou null si ce n'est pas une URL http(s) avec un hôte. */
function parse(url: unknown): ParsedUrl | null {
  if (typeof url !== "string") return null;
  const text = url.replace(EDGE_BLANKS, "");
  const match = URL_RE.exec(text);
  if (!match) return null;
  const [, scheme, authority, rest] = match;
  const at = authority.lastIndexOf("@");
  const userinfo = authority.slice(0, at + 1);
  const hostport = authority.slice(at + 1);
  if (!hostOf(hostport)) return null;
  return { text, scheme, userinfo, hostport, rest };
}

/**
 * La clé des doublons, ou null pour une URL écartée : schéma et hôte en
 * minuscules, un `www.` de tête de l'hôte retiré, fragment retiré, puis une
 * barre `/` finale.
 */
export function urlKey(url: unknown): string | null {
  const parsed = parse(url);
  if (!parsed) return null;
  const { scheme, userinfo, hostport, rest } = parsed;
  let host = asciiLower(hostport);
  if (host.startsWith("www.")) host = host.slice(4);
  const key = `${asciiLower(scheme)}://${userinfo}${host}${rest.split("#", 1)[0]}`;
  return key.endsWith("/") ? key.slice(0, -1) : key;
}

/** L'hôte officiel tiré de `School.official_domain`, sans `www.` de tête ; null s'il est vide. */
export function officialHost(officialDomain: unknown): string | null {
  if (typeof officialDomain !== "string") return null;
  const text = officialDomain.replace(EDGE_BLANKS, "").replace(SCHEME_RE, "");
  const authority = text.split(/[/?#]/, 1)[0];
  let host = asciiLower(hostOf(authority.slice(authority.lastIndexOf("@") + 1)));
  if (host.startsWith("www.")) host = host.slice(4);
  return host || null;
}

function isOnHost(url: unknown, host: string | null): boolean {
  const parsed = parse(url);
  if (!parsed || !host) return false;
  const urlHost = asciiLower(hostOf(parsed.hostport));
  return urlHost === host || urlHost.endsWith(`.${host}`);
}

/** Vrai si l'URL est sur le domaine officiel ou sur un de ses sous-domaines. */
export function isOfficialUrl(url: unknown, officialDomain: unknown): boolean {
  return isOnHost(url, officialHost(officialDomain));
}

/**
 * Les URL citées par une charge : toute clé `source_url` (une chaîne) ou
 * `source_urls` (une liste de chaînes), à toute profondeur, dans l'ordre de
 * lecture. Les valeurs sont rendues telles quelles : le tri vient après.
 */
export function citedUrls(payload: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node !== null && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (key === "source_url") {
          if (typeof value === "string") found.push(value);
        } else if (key === "source_urls") {
          if (Array.isArray(value)) found.push(...value.filter((v): v is string => typeof v === "string"));
        } else {
          walk(value);
        }
      }
    }
  };
  walk(payload);
  return found;
}

export interface TicketSourcesInput {
  /** La liste que l'écrivain stockait jusqu'ici, dans son ordre (les sources de Tavily). */
  reservoir: readonly unknown[];
  /** La charge du ticket, où sont relevées les URL citées. */
  payload?: unknown;
  /** `School.official_domain` ; null si inconnu (pas de groupe officiel). */
  officialDomain: string | null | undefined;
  /** La page catalogue en Phase 1 : la première prend la première place. */
  priorityUrls?: readonly unknown[];
  limit?: number;
}

/** Les liens du bloc « Sources » d'un ticket du pipeline, `limit` au plus. */
export function selectTicketSources({
  reservoir,
  payload = null,
  officialDomain,
  priorityUrls = [],
  limit = MAX_TICKET_SOURCES,
}: TicketSourcesInput): string[] {
  const chosen: string[] = [];
  const seen = new Set<string>();
  const offer = (url: unknown) => {
    if (chosen.length >= limit) return;
    const parsed = parse(url);
    if (!parsed) return;
    const key = urlKey(parsed.text)!;
    if (seen.has(key)) return;
    seen.add(key);
    chosen.push(parsed.text);
  };

  const pool = [...(reservoir ?? [])];
  const priority = (priorityUrls ?? []).filter((url) => parse(url) !== null);
  const host = officialHost(officialDomain);

  if (priority.length > 0) offer(priority[0]);
  citedUrls(payload).forEach(offer);
  priority.slice(1).forEach(offer);
  pool.filter((url) => isOnHost(url, host)).forEach(offer);
  pool.forEach(offer);
  return chosen;
}

/** Ce que l'inbox sait d'un ticket pour son bloc « Sources ». */
export interface TicketSourcesView {
  source_type: string;
  urls: string[];
  ai_extracted_json: unknown;
}

function isDiscoveryPayload(json: unknown): boolean {
  return (
    json !== null &&
    typeof json === "object" &&
    Array.isArray((json as Record<string, unknown>).discovered_campuses)
  );
}

/**
 * Les liens que montre le bloc « Sources » de l'inbox.
 *
 * - Contribution du public : ses URL, toutes, telles quelles.
 * - Ticket du pipeline qui en porte au plus 3 : tel qu'écrit. C'est le cas de
 *   tout ticket écrit depuis la coupe ; lui réappliquer la sélection pourrait
 *   y faire entrer une URL citée que l'écriture n'avait pas retenue (et la
 *   charge relue en jsonb n'a plus l'ordre de ses clés).
 * - Au-delà (tickets écrits avant la coupe) : les 3 que choisit
 *   `selectTicketSources`. Pour une découverte de Phase 1, la première URL
 *   tient la place réservée au catalogue : la Phase 1 a toujours écrit ses
 *   pages catalogue en tête de la liste. Une découverte sans catalogue n'a
 *   pas laissé de marque : sa première source Tavily prend alors cette place.
 */
export function displayedTicketSources(
  ticket: TicketSourcesView,
  officialDomain: string | null | undefined
): string[] {
  if (ticket.source_type !== AUTOMATED_AI || ticket.urls.length <= MAX_TICKET_SOURCES) {
    return ticket.urls;
  }
  return selectTicketSources({
    reservoir: ticket.urls,
    payload: ticket.ai_extracted_json,
    officialDomain,
    priorityUrls: isDiscoveryPayload(ticket.ai_extracted_json) ? ticket.urls.slice(0, 1) : [],
  });
}
