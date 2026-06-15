"""
backend/tavily/client.py — Client Tavily Unifié (Étape 5.1)

Fonctions de crawl, search et extract via Tavily Python SDK.
Utilise le TavilyKeyManager pour la rotation automatique des clés.

Référence : architecture.md §4.1, task.md §5.1
"""

import logging
from typing import Optional

logger = logging.getLogger("pipeline.tavily_client")

# Timeout des appels Tavily (Edge Case 14 : réponse vide ou lente)
CRAWL_TIMEOUT_SECONDS = 15
SEARCH_TIMEOUT_SECONDS = 10
EXTRACT_TIMEOUT_SECONDS = 15


def crawl_school_website(
    official_domain: str,
    key_manager,
    max_depth: int = 2,
) -> str:
    """
    Crawle le site officiel d'une école pour extraire le contenu des formations.

    Utilise Tavily crawl avec :
    - select_paths=["/formations/.*", "/programmes/.*", "/nos-formations/.*"]
    - instructions orientées vers les campus et programmes
    - max_depth=2 pour couvrir les sous-pages

    Args:
        official_domain: Domaine de l'école (ex: "emlv.fr")
        key_manager: Instance de TavilyKeyManager
        max_depth: Profondeur de crawl (défaut: 2)

    Returns:
        Contenu Markdown consolidé de toutes les pages crawlées.
        Retourne "" si le crawl échoue ou retourne vide (Edge Case 14).

    Référence : architecture.md §4.1 (crawl), task.md §5.1
    """
    from tavily import TavilyClient
    from backend.tavily_service.key_manager import QuotaExhaustedError

    url = f"https://{official_domain}"

    api_key = key_manager.get_active_key(required_credits=5)
    client = TavilyClient(api_key=api_key)

    logger.info(f"🔍 Tavily crawl: {url} (max_depth={max_depth})")

    try:
        result = client.crawl(
            url=url,
            max_depth=max_depth,
            select_paths=[
                "/formations/.*",
                "/programmes/.*",
                "/nos-formations/.*",
                "/programme/.*",
                "/formation/.*",
                "/cursus/.*",
                "/offre-de-formation/.*",
            ],
            instructions=(
                "Find all academic programs (formations), campuses, admission exams, "
                "alternance options, and expatriation requirements. "
                "Focus on official program names and campus locations."
            ),
        )

        # Enregistrer l'utilisation (1 crédit pour le crawl)
        key_manager.record_usage(api_key, credits=1)

        # Consolider les résultats en un seul texte Markdown
        pages = result.get("results", []) if isinstance(result, dict) else []
        if not pages:
            logger.warning(f"⚠️ Tavily crawl {url} — aucune page retournée (Edge Case 14)")
            return ""

        content_parts = []
        for page in pages:
            page_url = page.get("url", "")
            page_content = page.get("raw_content") or page.get("content", "")
            if page_content and len(page_content.strip()) > 100:
                content_parts.append(f"## Source: {page_url}\n\n{page_content}")

        consolidated = "\n\n---\n\n".join(content_parts)
        logger.info(
            f"✅ Crawl terminé: {len(pages)} pages, {len(consolidated)} chars au total"
        )
        return consolidated

    except QuotaExhaustedError:
        raise
    except Exception as e:
        error_str = str(e)
        if "timeout" in error_str.lower() or "timed out" in error_str.lower():
            logger.warning(f"⏱️ Timeout Tavily crawl {url} (Edge Case 14)")
        else:
            logger.error(f"❌ Erreur Tavily crawl {url}: {e}")
        return ""


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

    api_key = key_manager.get_active_key(required_credits=5)
    client = TavilyClient(api_key=api_key)

    logger.info(f"📥 Tavily extract: {len(urls)} URL(s)")

    try:
        result = client.extract(
            urls=urls[:5],  # Max 5 URLs par appel
            extract_depth=extract_depth,
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
        logger.error(f"❌ Erreur Tavily extract: {e}")
        return ""
