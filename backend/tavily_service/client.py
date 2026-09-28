"""
backend/tavily/client.py — Client Tavily Unifié (Étape 5.1)

Fonctions search, extract et map via Tavily Python SDK.
Utilise le TavilyKeyManager pour la rotation automatique des clés.

crawl_school_website() a été retirée le 28 septembre 2026 : héritée de la Phase 1
d'origine (crawl + Gemma), elle n'était plus appelée nulle part depuis que la
découverte passe par Tavily Research. La découverte des fiches formation passe
par map_program_pages().

Référence : architecture.md §4.1, task.md §5.1
"""

import logging
import os
from typing import Optional

from backend.tavily_service.key_manager import is_quota_error

logger = logging.getLogger("pipeline.tavily_client")

# ── Timeouts des appels Tavily (Edge Case 14 : réponse vide ou lente) ────
#
# Ces constantes étaient déclarées et n'apparaissaient nulle part ailleurs dans
# le fichier : les requêtes partaient sans limite explicite, dans un thread
# APScheduler. Elles sont désormais passées aux appels du SDK.
#
# Les valeurs affichées avant (10 / 15 s) n'ont jamais été appliquées. On reprend
# donc les valeurs effectives (celles du SDK), qui ne changent rien au
# comportement observé mais rendent le réglage réel et ajustable par
# l'environnement. MAP_TIMEOUT_SECONDS est déclaré plus bas, avec /map.
SEARCH_TIMEOUT_SECONDS = float(os.environ.get("TAVILY_SEARCH_TIMEOUT_SECONDS", 60))
EXTRACT_TIMEOUT_SECONDS = float(os.environ.get("TAVILY_EXTRACT_TIMEOUT_SECONDS", 30))

# Tavily facture 1 crédit par tranche de 5 URLs et n'en accepte pas davantage
# par appel. Le surplus était tronqué en silence : l'appelant croyait ses URLs
# analysées. Voir split_extractable_urls().
EXTRACT_MAX_URLS = 5


def split_extractable_urls(urls: list[str] | None) -> tuple[list[str], list[str]]:
    """
    Sépare les URLs qui partiront à Tavily de celles qui seront écartées.

    Permet à l'appelant de signaler les URLs ignorées à l'admin, au lieu de les
    voir disparaître dans un `urls[:5]`.
    """
    all_urls = list(urls or [])
    return all_urls[:EXTRACT_MAX_URLS], all_urls[EXTRACT_MAX_URLS:]


def search_web(
    query: str,
    key_manager,
    include_domains: Optional[list[str]] = None,
    search_depth: str = "basic",
    max_results: int = 5,
    include_raw_content: bool = True,
    country: str = "france",
) -> str:
    """
    Effectue une recherche web ciblée via Tavily search.
    Utilisé en Phase 2 (Enrichissement) pour chaque catégorie.

    Args:
        query: Requête de recherche (avec {school}, {program}, etc. déjà interpolés)
        key_manager: Instance de TavilyKeyManager
        include_domains: Domaines prioritaires (ex: ["emlv.fr"])
        search_depth: "basic" (1 crédit) ou "advanced" (2 crédits)
        max_results: Nombre max de résultats
        include_raw_content: Inclure le contenu brut des pages
        country: Pays pour la recherche

    Returns:
        Contenu consolidé des résultats (Markdown).

    Référence : architecture.md §4.2 (Phase 2 strategies)
    """
    from tavily import TavilyClient
    from backend.tavily_service.key_manager import QuotaExhaustedError

    api_key = key_manager.get_active_key(required_credits=5)
    client = TavilyClient(api_key=api_key)

    logger.info(f"🔎 Tavily search: '{query[:80]}...' (depth={search_depth})")

    try:
        params = {
            "query": query,
            "search_depth": search_depth,
            "max_results": max_results,
            "include_raw_content": include_raw_content,
            "timeout": SEARCH_TIMEOUT_SECONDS,
        }
        if include_domains:
            params["include_domains"] = include_domains
        if country:
            params["country"] = country

        result = client.search(**params)

        # Enregistrer l'utilisation
        credits = 2 if search_depth == "advanced" else 1
        key_manager.record_usage(api_key, credits=credits)

        # Consolider
        results_list = result.get("results", []) if isinstance(result, dict) else []
        if not results_list:
            logger.warning(f"⚠️ Aucun résultat pour: '{query[:60]}'")
            return ""

        content_parts = []
        for r in results_list:
            url = r.get("url", "")
            content = r.get("raw_content") or r.get("content", "")
            if content and len(content.strip()) > 50:
                content_parts.append(f"## Source: {url}\n\n{content}")

        consolidated = "\n\n---\n\n".join(content_parts)
        logger.info(f"✅ Search terminé: {len(results_list)} résultats, {len(consolidated)} chars")
        return consolidated

    except QuotaExhaustedError:
        raise
    except Exception as e:
        if is_quota_error(e):
            # research_client.py etait le seul a marquer la cle. Sans cet
            # appel, une cle refusee par l API (402/429) restait selectionnee
            # et etait reinterrogee en boucle par les appels suivants.
            logger.warning(
                f"⚠️ Quota Tavily atteint sur la cle ...{api_key[-6:]} — marquee epuisee"
            )
            key_manager.mark_exhausted(api_key)
        logger.error(f"❌ Erreur Tavily search '{query[:60]}': {e}")
        return ""


def extract_from_urls(
    urls: list[str],
    key_manager,
    extract_depth: str = "advanced",
) -> str:
    """
    Extrait le contenu de URLs spécifiques via Tavily extract.
    Utilisé dans le Workflow A (Crowdsourcing) pour vérifier les sources utilisateur.

    Args:
        urls: Liste d'URLs à extraire (max 5 recommandé, 1 crédit/5 URLs)
        key_manager: Instance de TavilyKeyManager
        extract_depth: "basic" ou "advanced"

    Returns:
        Contenu consolidé des pages.

    Référence : architecture.md §4.1 (extract), task.md §7.3
    """
    from tavily import TavilyClient
    from backend.tavily_service.key_manager import QuotaExhaustedError

    if not urls:
        return ""

    # Le surplus était écarté en silence par un `urls[:5]` en ligne. Il est
    # désormais journalisé ici, et l'appelant peut le remonter à l'admin via
    # split_extractable_urls().
    kept_urls, ignored_urls = split_extractable_urls(urls)
    if ignored_urls:
        logger.warning(
            f"⚠️ Tavily extract : {len(ignored_urls)} URL(s) écartée(s) "
            f"(maximum {EXTRACT_MAX_URLS} par appel) — {ignored_urls}"
        )

    api_key = key_manager.get_active_key(required_credits=5)
    client = TavilyClient(api_key=api_key)

    logger.info(f"📥 Tavily extract: {len(kept_urls)} URL(s)")

    try:
        result = client.extract(
            urls=kept_urls,
            extract_depth=extract_depth,
            timeout=EXTRACT_TIMEOUT_SECONDS,
        )

        # 1 crédit par 5 URLs
        key_manager.record_usage(api_key, credits=1)

        results_list = result.get("results", []) if isinstance(result, dict) else []
        content_parts = []
        for r in results_list:
            url = r.get("url", "")
            content = r.get("raw_content") or r.get("content", "")
            if content and len(content.strip()) > 50:
                content_parts.append(f"## Source: {url}\n\n{content}")

        consolidated = "\n\n---\n\n".join(content_parts)
        logger.info(f"✅ Extract terminé: {len(results_list)} résultats")
        return consolidated

    except QuotaExhaustedError:
        raise
    except Exception as e:
        if is_quota_error(e):
            # research_client.py etait le seul a marquer la cle. Sans cet
            # appel, une cle refusee par l API (402/429) restait selectionnee
            # et etait reinterrogee en boucle par les appels suivants.
            logger.warning(
                f"⚠️ Quota Tavily atteint sur la cle ...{api_key[-6:]} — marquee epuisee"
            )
            key_manager.mark_exhausted(api_key)
        logger.error(f"❌ Erreur Tavily extract: {e}")
        return ""


# ── /map — cartographie enracinee sur la page catalogue ──────────
#
# /map ne lit rien, il enumere des URL : c'est l'etape de decouverte des fiches
# formation. (Un crawl, lui, lit le contenu des pages ; celui de la Phase 1
# d'origine a ete retire, la decouverte passant par Tavily Research.)
#
# Enracinement : TOUJOURS la page catalogue, JAMAIS la racine du domaine.
# Mesure du 4 septembre 2026 sur em-normandie.com : depuis la racine, /map rend
# 114 URL dont 2 seulement sous /programmes, et ce sont deux pages thematiques.
# Enracine sur la page catalogue, le meme appel en rend 61. La racine n'est pas
# un point de depart degrade, c'est un point de depart faux — d'ou le refus
# explicite de map_program_pages() plutot qu'un simple avertissement.
MAP_TIMEOUT_SECONDS = float(os.environ.get("TAVILY_MAP_TIMEOUT_SECONDS", 120))

# /map n'est PAS facture a l'appel mais a la page decouverte : deux appels ont
# coute 11 credits pendant la campagne du 4 septembre. Un `record_usage(1)` en
# dur sous-compterait d'un facteur cinq. On lit donc le cout declare.
MAP_FALLBACK_CREDITS = 5

# Meme marge de securite que la passe catalogue : les endpoints de decouverte
# coutent l'unite, le key manager raisonne en reserve.
MAP_REQUIRED_CREDITS = 5

# Nombre de cles essayees avant d'abandonner la cartographie.
#
# Les trois wrappers ci-dessus abandonnent des la premiere cle refusee, et
# c'est tolerable pour eux : un /search rate, c'est un resultat en moins. /map
# est l'etape de DECOUVERTE — si elle rend zero URL, il n'y a plus rien a
# lire ensuite et toute la passe s'arrete.
#
# Le refus n'est d'ailleurs pas fiable a l'avance : mesure le 4 septembre 2026,
# le compteur local d'une cle annoncait 48 credits restants quand l'API
# refusait deja l'appel (« exceeds your plan's set usage limit »). Le compteur
# Tavily n'est pas temps reel, donc `required_credits` ne peut pas ecarter
# cette cle : seule la reponse de l'API le dit. On la marque et on passe a la
# suivante.
MAP_KEY_ATTEMPTS = 3


def record_reported_usage(key_manager, api_key: str, response: dict, fallback: int) -> int:
    """
    Alimente le compteur du key manager avec le cout REEL de l'appel.

    `include_usage: true` fait revenir un objet `usage` portant les credits
    factures ; il fonctionne sur /search, /extract et /map. `fallback` sert
    quand la reponse ne le declare pas.

    catalog_client._record_real_usage fait la meme chose, pour la meme raison.
    Les deux ne sont pas fusionnees ici : cette copie-la est sur le chemin chaud
    de la Phase 1 et la reunir est un changement a part entiere.
    """
    credits = fallback
    usage = response.get("usage") if isinstance(response, dict) else None
    if isinstance(usage, dict):
        reported = usage.get("credits")
        if isinstance(reported, (int, float)):
            credits = int(reported)
    key_manager.record_usage(api_key, credits=credits)
    return credits


def is_rooted_on_page(url: str) -> bool:
    """
    Vrai si l'URL designe une PAGE et non la racine d'un domaine.

    « https://www.em-normandie.com/ » et « em-normandie.com » sont des racines ;
    « https://www.em-normandie.com/programmes » est une page.
    """
    from urllib.parse import urlparse

    parsed = urlparse(url if "://" in (url or "") else f"https://{url or ''}")
    return bool(parsed.netloc) and len([p for p in (parsed.path or "").split("/") if p]) > 0


def map_program_pages(
    catalog_url: str,
    key_manager,
    instructions: Optional[str] = None,
    max_depth: int = 1,
    limit: int = 200,
) -> tuple[list[str], int]:
    """
    Enumere les URL de fiches formation atteignables depuis une page catalogue.

    Args:
        catalog_url: URL de la page d'index des formations. Une racine de
            domaine est REFUSEE (voir le commentaire de section).
        key_manager: Instance de TavilyKeyManager
        instructions: Consigne de cartographie. Sans elle, /map suit surtout la
            navigation ; la campagne du 3 septembre a obtenu 48 URL avec, et 2
            sans, sur la meme racine.
        max_depth: Profondeur de suivi des liens depuis la racine choisie.
        limit: Plafond d'URL rendues.

    Returns:
        (URL triees et dedoublonnees, credits consommes). Une liste vide n'est
        pas une erreur : l'appelant se rabat sur les cartes d'index.

    Cette fonction ne leve pas, sauf QuotaExhaustedError comme ses voisines.
    """
    from tavily import TavilyClient
    from backend.tavily_service.key_manager import QuotaExhaustedError

    if not is_rooted_on_page(catalog_url):
        # Refus et non repli : partir de la racine rend un resultat *plausible*
        # (114 URL) et faux (2 fiches). Un appel qui echoue franchement coute
        # moins cher qu'un appel qui reussit mal.
        logger.error(
            "❌ /map refuse : '%s' est une racine de domaine. "
            "La cartographie s'enracine sur la page catalogue.",
            catalog_url,
        )
        return [], 0

    params = {
        "url": catalog_url,
        "max_depth": max_depth,
        "limit": limit,
        "include_usage": True,
        "timeout": MAP_TIMEOUT_SECONDS,
    }
    if instructions:
        params["instructions"] = instructions

    for attempt in range(1, MAP_KEY_ATTEMPTS + 1):
        api_key = key_manager.get_active_key(required_credits=MAP_REQUIRED_CREDITS)
        client = TavilyClient(api_key=api_key)

        logger.info(
            "🗺️ Tavily map: %s (max_depth=%d, essai %d/%d)",
            catalog_url, max_depth, attempt, MAP_KEY_ATTEMPTS,
        )

        try:
            result = client.map(**params)
        except QuotaExhaustedError:
            raise
        except Exception as e:
            if is_quota_error(e):
                logger.warning(
                    f"⚠️ Quota Tavily atteint sur la cle ...{api_key[-6:]} — marquee epuisee"
                )
                key_manager.mark_exhausted(api_key)
                continue
            error_str = str(e)
            if "timeout" in error_str.lower() or "timed out" in error_str.lower():
                logger.warning(f"⏱️ Timeout Tavily map {catalog_url}")
            else:
                logger.error(f"❌ Erreur Tavily map {catalog_url}: {e}")
            return [], 0

        credits = record_reported_usage(
            key_manager, api_key, result, fallback=MAP_FALLBACK_CREDITS
        )

        raw = result.get("results", []) if isinstance(result, dict) else []
        urls = sorted({u for u in raw if isinstance(u, str) and u.strip()})
        if not urls:
            # Pas une panne : le site peut bloquer la cartographie. L'appelant a
            # les cartes d'index, qui sont de toute facon la source la plus riche.
            logger.warning("⚠️ Tavily map %s — aucune URL rendue", catalog_url)

        logger.info("✅ Map termine : %d URL, %d credit(s)", len(urls), credits)
        return urls, credits

    logger.error(
        "❌ /map abandonne apres %d cle(s) refusee(s) pour quota : %s",
        MAP_KEY_ATTEMPTS, catalog_url,
    )
    return [], 0
