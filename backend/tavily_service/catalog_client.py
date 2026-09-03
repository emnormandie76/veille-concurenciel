"""
backend/tavily_service/catalog_client.py — Ancrage catalogue de la Phase 1

## Pourquoi ce module existe

Un agent de recherche sert à recouper ce que personne ne publie au même
endroit. Le catalogue de formations d'une école est l'exact contraire : UNE
page, tenue à jour par l'école, à une URL stable.

Mesuré sur EM Normandie : la page /programmes rend 16 formations avec leurs
intitulés exacts en un appel /extract, quand la meilleure variante Research en
reconstitue 10, dont certaines sous des noms approximatifs. Aucun réglage de
schéma, de prompt ou de modèle ne franchit ce plafond — ce n'est pas un plafond
de qualité de recherche, c'est la différence entre lire une liste et la deviner.

Le coût est dérisoire : un /search (1 crédit) et un /extract (1 crédit par lot
de 5 URLs réussies), contre 25 crédits estimés pour un appel Research `pro`.

## Ce qui n'est PAS résolu, et qu'il faut garder en tête

Localiser automatiquement la page catalogue n'est pas un problème réglé. Sur
EM Normandie elle a été trouvée à la main, avec une requête écrite en sachant ce
qu'on cherchait. C'est le seul point du dossier mesuré sur UNE seule école.

D'où la règle qui gouverne tout ce module : **l'ancrage est un bonus, jamais une
dépendance dure.** Pas de catalogue trouvé, pas d'ancrage — on garde le résultat
Research seul, qui reste très supérieur à l'existant. Aucune fonction d'ici ne
lève : elles rendent None et laissent la Phase 1 continuer.

## /map est un piège

C'était la voie évidente. Sur em-normandie.com il rend **0 URL** : le site
bloque le crawl. Facturé 0 crédit, mais inutilisable. La voie principale est
/search restreint au domaine ; /map n'est gardé qu'en complément opportuniste.

Référence : dossier « Le rapport avant le schéma », sections 03, 04 et 11.
"""

import logging
import re
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlparse

from tavily import TavilyClient

from backend.tavily_service.key_manager import QuotaExhaustedError, is_quota_error

logger = logging.getLogger("pipeline.catalog")

SEARCH_TIMEOUT_SECONDS = 30.0
EXTRACT_TIMEOUT_SECONDS = 60.0

# Crédits réservés avant l'appel. Les endpoints catalogue coûtent l'unité, mais
# le key manager raisonne en marge de sécurité.
CATALOG_REQUIRED_CREDITS = 5

# Tavily facture /extract par lot de 5 URLs réussies. Au-delà de deux pages, on
# recoupe surtout du bruit.
MAX_CATALOG_PAGES = 2

# Requêtes d'amorçage, du plus précis au plus générique. Elles sont lancées dans
# l'ordre et on s'arrête dès qu'une candidate convaincante sort : chaque requête
# coûte un crédit.
_CATALOG_QUERIES = (
    "{school} liste de toutes les formations et programmes diplômants",
    "{school} nos programmes catalogue des formations",
    "{school} programmes bachelor master MSc MBA",
)

# Segments d'URL qui trahissent une page d'index de formations. Le score
# n'ordonne que des candidates déjà restreintes au domaine officiel : il ne
# décide pas de la pertinence, il départage.
_PATH_SCORES = (
    (re.compile(r"/(programmes|nos-programmes|our-programmes|programs|programmes-diplomants)/?$"), 10),
    (re.compile(r"/(formations|nos-formations|toutes-nos-formations|courses)/?$"), 10),
    (re.compile(r"/(cursus|diplomes|catalogue)/?$"), 8),
    (re.compile(r"/(programmes|formations|programs|courses)(/|$)"), 5),
    (re.compile(r"/(admissions|etudier|study)(/|$)"), 2),
)

# Mots d'un titre de page d'index. Un titre qui les porte vaut mieux qu'un
# titre de fiche formation isolée.
_TITLE_WORDS = (
    "programmes", "formations", "nos formations", "nos programmes",
    "our programmes", "programs", "courses", "catalogue", "cursus",
)


@dataclass
class CatalogResult:
    """Ce qu'une passe catalogue réussie rapporte."""

    urls: list[str]
    content: str
    credits_used: int = 0
    program_titles: list[str] = field(default_factory=list)

    @property
    def has_content(self) -> bool:
        return bool(self.content and self.content.strip())


def _record_real_usage(key_manager, api_key: str, response: dict, fallback: int) -> int:
    """
    Alimente le compteur du key manager avec le coût RÉEL de l'appel.

    `include_usage: true` fait revenir un objet `usage` portant les crédits
    facturés. Il fonctionne sur /search, /extract et /map — et pas sur
    /research, dont la réponse ne contient aucun champ `usage`, ni en `mini` ni
    en `pro`. Le seul appel dont le coût compte vraiment est précisément le seul
    qui ne le déclare pas ; ici, au moins, le chiffre est mesuré.
    """
    credits = fallback
    usage = response.get("usage") if isinstance(response, dict) else None
    if isinstance(usage, dict):
        reported = usage.get("credits")
        if isinstance(reported, (int, float)):
            credits = int(reported)
    key_manager.record_usage(api_key, credits=credits)
    return credits


def _bare_host(value: str | None) -> str:
    """
    Ramène une valeur de domaine à un hôte comparable.

    La colonne `School.official_domain` n'est pas propre en production : une
    école y porte « www.em-normandie.com », une autre « em-strasbourg.com/fr »
    — avec un chemin. Comparées telles quelles, la première rejetait ses propres
    sous-domaines et la seconde ne pouvait correspondre à AUCUNE URL, ce qui
    aurait désactivé l'ancrage catalogue en silence pour cette école.

    On retire donc le schéma, le port, le chemin et le « www. » de tête, des
    deux côtés de la comparaison.
    """
    host = (value or "").strip().lower()
    host = host.split("://")[-1]
    host = host.split("/")[0].split("?")[0].split("#")[0]
    host = host.split(":")[0].strip(".")
    return host[4:] if host.startswith("www.") else host


def _score_candidate(url: str, title: str, official_domain: str) -> int:
    """Note une URL candidate au rôle de page catalogue."""
    parsed = urlparse(url)
    host = _bare_host(parsed.netloc)
    domain = _bare_host(official_domain)
    # Le domaine doit être le SUFFIXE de l'hôte, pas une sous-chaîne : les
    # sous-domaines de l'école comptent (en.em-normandie.com), un hôte tiers qui
    # contient son nom ne compte pas.
    if not domain or (host != domain and not host.endswith("." + domain)):
        return -1

    score = 0
    path = (parsed.path or "/").lower()
    for pattern, points in _PATH_SCORES:
        if pattern.search(path):
            score += points
            break

    lowered = (title or "").lower()
    if any(word in lowered for word in _TITLE_WORDS):
        score += 4

    # Une page d'index est haut dans l'arborescence ; une fiche formation est
    # profonde. À score de chemin égal, la moins profonde gagne.
    depth = len([part for part in path.split("/") if part])
    score -= depth

    return score


def find_catalog_pages(
    school_name: str,
    official_domain: str,
    key_manager,
    max_pages: int = MAX_CATALOG_PAGES,
) -> tuple[list[str], int]:
    """
    Localise la ou les pages d'index des formations, via /search restreint au
    domaine officiel.

    Retourne (URLs, crédits consommés). Une liste vide n'est pas une erreur :
    c'est le cas de repli prévu, et la Phase 1 continue sans ancrage.
    """
    credits_total = 0
    seen: dict[str, int] = {}

    for template in _CATALOG_QUERIES:
        query = template.format(school=school_name)
        try:
            api_key = key_manager.get_active_key(required_credits=CATALOG_REQUIRED_CREDITS)
        except QuotaExhaustedError:
            logger.warning("⚠️ Plus de crédits Tavily pour la passe catalogue — ancrage abandonné")
            return list(seen)[:max_pages], credits_total

        client = TavilyClient(api_key=api_key)
        try:
            response = client.search(
                query=query,
                search_depth="basic",
                max_results=20,
                include_domains=[official_domain],
                include_raw_content=False,
                include_usage=True,
                timeout=SEARCH_TIMEOUT_SECONDS,
                country="france",
            )
        except Exception as e:
            if is_quota_error(e):
                logger.warning("⚠️ Quota Tavily sur ...%s — clé marquée épuisée", api_key[-6:])
                key_manager.mark_exhausted(api_key)
                continue
            logger.warning("⚠️ Échec /search catalogue ('%s') : %s", query[:60], e)
            continue

        credits_total += _record_real_usage(key_manager, api_key, response, fallback=1)

        for item in response.get("results", []) if isinstance(response, dict) else []:
            url = item.get("url")
            if not url:
                continue
            score = _score_candidate(url, item.get("title", ""), official_domain)
            if score > seen.get(url, -999):
                seen[url] = score

        best = max(seen.values(), default=-1)
        if best >= 8:
            # Une page d'index franche est sortie : inutile de payer les
            # requêtes suivantes.
            break

    ranked = sorted(
        (url for url, score in seen.items() if score > 0),
        key=lambda url: seen[url],
        reverse=True,
    )
    if not ranked:
        logger.info("🔍 Aucune page catalogue identifiée pour %s", official_domain)
    else:
        logger.info(
            "🔍 Page(s) catalogue retenue(s) pour %s : %s",
            official_domain, ranked[:max_pages],
        )
    return ranked[:max_pages], credits_total


def fetch_catalog_content(
    urls: list[str],
    key_manager,
) -> tuple[str, int]:
    """
    Lit les pages catalogue telles qu'elles sont publiées, via /extract.

    Retourne (contenu markdown consolidé, crédits consommés).
    """
    if not urls:
        return "", 0

    try:
        api_key = key_manager.get_active_key(required_credits=CATALOG_REQUIRED_CREDITS)
    except QuotaExhaustedError:
        logger.warning("⚠️ Plus de crédits Tavily pour /extract catalogue — ancrage abandonné")
        return "", 0

    client = TavilyClient(api_key=api_key)
    try:
        response = client.extract(
            urls=urls,
            extract_depth="advanced",
            include_usage=True,
            timeout=EXTRACT_TIMEOUT_SECONDS,
        )
    except Exception as e:
        if is_quota_error(e):
            logger.warning("⚠️ Quota Tavily sur ...%s — clé marquée épuisée", api_key[-6:])
            key_manager.mark_exhausted(api_key)
        logger.warning("⚠️ Échec /extract catalogue : %s", e)
        return "", 0

    credits = _record_real_usage(key_manager, api_key, response, fallback=1)

    parts: list[str] = []
    for result in response.get("results", []) if isinstance(response, dict) else []:
        url = result.get("url", "")
        content = result.get("raw_content") or result.get("content") or ""
        if content.strip():
            parts.append(f"## Source: {url}\n\n{content}")

    consolidated = "\n\n---\n\n".join(parts)
    logger.info(
        "📥 Catalogue extrait : %d page(s), %d caractères, %d crédit(s)",
        len(parts), len(consolidated), credits,
    )
    return consolidated, credits


def fetch_catalog(
    school_name: str,
    official_domain: str,
    key_manager,
    max_pages: int = MAX_CATALOG_PAGES,
) -> Optional[CatalogResult]:
    """
    Passe catalogue complète : localiser puis lire.

    Retourne None quand rien d'exploitable n'a été trouvé — c'est un résultat
    normal, pas une panne. L'appelant garde alors le rapport Research seul.
    Cette fonction ne lève jamais : une école dont le site bloque tout ne doit
    pas faire échouer sa Phase 1.
    """
    try:
        urls, search_credits = find_catalog_pages(
            school_name, official_domain, key_manager, max_pages=max_pages
        )
        if not urls:
            return None

        content, extract_credits = fetch_catalog_content(urls, key_manager)
        if not content.strip():
            logger.info("📭 Pages catalogue vides pour %s — pas d'ancrage", official_domain)
            return None

        return CatalogResult(
            urls=urls,
            content=content,
            credits_used=search_credits + extract_credits,
        )
    except QuotaExhaustedError:
        # Le quota Tavily est une contrainte globale du pipeline : la remonter
        # ferait échouer la Phase 1 sur une étape facultative.
        logger.warning("⚠️ Quota Tavily épuisé pendant la passe catalogue — ancrage abandonné")
        return None
    except Exception as e:
        logger.warning("⚠️ Passe catalogue abandonnée pour %s : %s", official_domain, e)
        return None
