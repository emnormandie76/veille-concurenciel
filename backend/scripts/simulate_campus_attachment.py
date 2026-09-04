"""
Sortie seche de la collecte « ou se deroule ce programme ».

Ce script LIT le web et n'ecrit RIEN en base. Il produit, par ecole, un JSON
contenant les lignes qu'il ecrirait dans `ProgramCampus`,
`ProgramCampusAttachment` et `ProgramPlacement` — plus ce qu'il a rejete et ce
qui se contredit. Aucune migration n'est appliquee, rien n'est branche dans
`phase1_research.py`.

    python -m backend.scripts.simulate_campus_attachment \\
        --school-name "EM Normandie" --domain www.em-normandie.com \\
        --campus Caen --campus "Le Havre" --campus Paris \\
        --campus Dublin --campus Oxford --campus "Dubai" \\
        --out tmp/dry

## La liste des campus est un PARAMETRE, pas une decouverte

`ProgramPlacement.kind` demande de savoir si « Shanghai » est un campus de
l'ecole (il l'est, chez Em Lyon) et si « Milan » en est un (non). L'etude a
nomme ce point comme le maillon faible du modele retenu : il faut la liste des
campus reels, que la Phase 1 produit deja mais que la base injoignable ne rend
pas. On la passe donc en argument. Demain elle viendra de `Campus` — la
signature de `build_rows()` ne changera pas.

## Chaine d'appels

  /search  page catalogue (catalog_client.find_catalog_pages)
  /map     enracine sur cette page — jamais sur la racine du domaine
  /extract les pages d'index, puis les fiches, 5 URL par appel
  Gemini   schema Campus_Attachment, min_tier="low", plusieurs fiches par appel

Aucun appel /research. Toutes les reponses brutes sont mises en cache sur
disque : un second passage ne coute pas un credit, et le rapport est
rejouable.
"""

import argparse
import hashlib
import json
import logging
import os
import re
import sys
import time
from typing import Optional
from urllib.parse import urlparse

sys.path.append(os.path.abspath("."))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from dotenv import load_dotenv  # noqa: E402

load_dotenv("backend/.env")

from backend.ai.extraction_prompts import get_extraction_prompt  # noqa: E402
from backend.ai.extraction_schemas import (  # noqa: E402
    get_extraction_schema,
    get_min_tier,
)
from backend.ai.gemini_client import ExtractionUnavailable, extract_structured  # noqa: E402
from backend.pipeline.campus_attachment import build_rows  # noqa: E402
from backend.tavily_service.catalog_client import find_catalog_pages  # noqa: E402
from backend.tavily_service.client import (  # noqa: E402
    EXTRACT_MAX_URLS,
    extract_from_urls,
    map_program_pages,
)
from backend.tavily_service.key_manager import TavilyKeyManager  # noqa: E402

logger = logging.getLogger("scripts.campus_attachment")

CATEGORY = "Campus_Attachment"

# Consigne de cartographie. Sans elle, /map suit surtout la navigation : la
# campagne du 3 septembre a obtenu 48 URL avec, et 2 sans, sur la meme racine.
MAP_INSTRUCTIONS = (
    "Find every individual degree programme page (fiche formation): bachelor, "
    "BBA, master, MSc, MS, MBA, PGE, doctorate. Follow the programme catalogue "
    "listing pages."
)

# Segments qui trahissent une page qui n'est pas une fiche formation. La
# formation continue est le gros du bruit : 19 des 28 URL de la facette Le
# Havre sont des sessions datees, sans encart Niveau/Campus/Rythme.
_NON_PROGRAM_PATTERNS = (
    re.compile(r"/(actualites?|news|news-entreprise|blog|events?|agenda|presse|press)(/|$)"),
    re.compile(r"/(mentions-legales|cookies|plan-du-site|contact|rgpd)(/|$)"),
    re.compile(r"/(admissions?|candidater|financement|logement|vie-etudiante)(/|$)"),
    re.compile(r"/(formation-continue|executive-education|entreprises)(/|$)"),
    # Em Lyon publie sous /guides/ des pages de conseil (« Quelle difference
    # entre bachelor et licence ? ») qui portent le vocabulaire des diplomes
    # sans en etre.
    re.compile(r"/guides?(/|$)"),
    re.compile(r"/(classement|accreditation|annuaire)[^/]*(/|$)"),
    re.compile(r"\.(pdf|jpe?g|png|gif|svg|zip|docx?)(/|$)"),
)


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return cleaned or "ecole"


def _cache_path(cache_dir: str, kind: str, key: str) -> str:
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
    return os.path.join(cache_dir, f"{kind}-{digest}.json")


def _is_worth_caching(kind: str, value) -> bool:
    """
    Une reponse VIDE ne se met pas en cache.

    Mesure du 4 septembre : un /map sur une cle presque epuisee est revenu avec
    0 URL et 0 credit, sans lever. Mis en cache, ce vide devient permanent et
    tous les passages suivants repartent de rien — une panne d'un instant se
    transforme en resultat stable et faux. Seul le succes est memorise.
    """
    if kind in ("map", "search"):
        return bool(value) and bool(value[0])
    if kind == "extract":
        return bool(value and str(value).strip())
    if kind == "gemini":
        return bool(isinstance(value, dict) and value.get("statements"))
    return True


def _cached(cache_dir: Optional[str], kind: str, key: str, producer):
    """
    Rejoue une reponse deja obtenue plutot que de la repayer.

    Le cache est la condition pour que ce rapport soit verifiable : sans lui,
    relire la sortie coute des credits et les pages peuvent avoir change.
    """
    if not cache_dir:
        return producer(), False
    os.makedirs(cache_dir, exist_ok=True)
    path = _cache_path(cache_dir, kind, key)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as handle:
            logger.info("♻️ Cache: %s (%s)", kind, key[:90])
            return json.load(handle), True
    value = producer()
    if _is_worth_caching(kind, value):
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
    else:
        logger.warning("⚠️ Reponse vide non mise en cache : %s (%s)", kind, key[:90])
    return value, False


def looks_like_program_page(
    url: str, catalog_path: str, path_prefix: Optional[str] = None
) -> bool:
    """
    Vrai si l'URL ressemble a une fiche formation.

    Le filtre est volontairement grossier : ecarter une vraie fiche coute une
    ligne manquante et se voit, garder une page de rubrique coute une ligne
    fausse et ne se voit pas.

    Il ne peut PAS exiger que l'URL descende de la page catalogue. EM Normandie
    range ses fiches sous sa page d'index (/programmes → /programmes/...), mais
    Em Lyon range son index en /fr/nos-programmes et ses fiches ailleurs, en
    /fr/etudiant/mastere-specialise/... Exiger le prefixe rejetterait la
    totalite d'une ecole sur deux. C'est /map, enracine sur le catalogue, qui
    borne la recolte ; ce filtre ne fait qu'oter le bruit connu. `--path-prefix`
    reste disponible quand l'operateur veut resserrer.
    """
    parsed = urlparse(url)
    path = (parsed.path or "").lower().rstrip("/")
    if not path:
        return False
    if any(pattern.search(path + "/") for pattern in _NON_PROGRAM_PATTERNS):
        return False
    if path_prefix and not path.startswith(path_prefix.lower().rstrip("/")):
        return False
    # La page d'index elle-meme n'est pas une fiche ; elle est lue a part.
    return path != (catalog_path or "").lower().rstrip("/")


def discover_urls(
    school_name: str,
    domain: str,
    key_manager,
    catalog_url: Optional[str],
    cache_dir: Optional[str],
    path_prefix: Optional[str] = None,
) -> tuple[list[str], list[str], int]:
    """Rend (pages d'index, fiches candidates, credits consommes)."""
    credits = 0
    index_pages: list[str] = []

    if catalog_url:
        index_pages = [catalog_url]
    else:
        payload, from_cache = _cached(
            cache_dir,
            "search",
            f"catalog::{domain}",
            lambda: list(find_catalog_pages(school_name, domain, key_manager)),
        )
        index_pages, search_credits = payload[0], payload[1]
        if not from_cache:
            credits += search_credits

    if not index_pages:
        logger.error("❌ Aucune page catalogue pour %s — rien a cartographier", domain)
        return [], [], credits

    catalog_path = urlparse(index_pages[0]).path or "/"

    mapped: list[str] = []
    for page in index_pages:
        payload, from_cache = _cached(
            cache_dir,
            "map",
            f"map::{page}",
            lambda p=page: list(map_program_pages(p, key_manager, instructions=MAP_INSTRUCTIONS)),
        )
        urls, map_credits = payload[0], payload[1]
        if not from_cache:
            credits += map_credits
        mapped.extend(urls)

    fiches = sorted(
        {u for u in mapped if looks_like_program_page(u, catalog_path, path_prefix)}
    )
    logger.info(
        "🗺️ %d URL cartographiees, %d retenues comme fiches", len(mapped), len(fiches)
    )
    return index_pages, fiches, credits


def extract_pages(urls: list[str], key_manager, cache_dir: Optional[str]) -> dict[str, str]:
    """Lit les pages par lots de 5 et rend {url: markdown}."""
    pages: dict[str, str] = {}
    for start in range(0, len(urls), EXTRACT_MAX_URLS):
        batch = urls[start : start + EXTRACT_MAX_URLS]
        content, _ = _cached(
            cache_dir,
            "extract",
            "extract::" + "|".join(batch),
            lambda b=batch: extract_from_urls(b, key_manager),
        )
        if not content:
            logger.warning("⚠️ Lot vide : %s", batch)
            continue
        # extract_from_urls consolide avec « ## Source: <url> ». On redecoupe
        # pour garder l'appariement page <-> contenu, que le modele doit voir.
        for chunk in content.split("\n\n---\n\n"):
            head, _, body = chunk.partition("\n\n")
            url = head.replace("## Source:", "").strip()
            if url and body.strip():
                pages[url] = body
    return pages


def run_extraction(
    pages: dict[str, str],
    batch_size: int,
    page_chars: int,
    cache_dir: Optional[str],
) -> tuple[dict, list[dict]]:
    """
    Groupe les fiches et les passe a Gemini.

    Le groupage n'est pas une optimisation de confort : le portillon global de
    gemini_client espace les appels de 12 s (5 RPM sur la cle). Cinquante
    fiches une par une, c'est dix minutes d'attente pure.
    """
    prompt = get_extraction_prompt(CATEGORY)
    schema = get_extraction_schema(CATEGORY)
    min_tier = get_min_tier(CATEGORY)

    merged: dict = {"statements": [], "policies": []}
    failures: list[dict] = []
    urls = sorted(pages)

    for start in range(0, len(urls), batch_size):
        batch = urls[start : start + batch_size]
        source = "\n\n---\n\n".join(
            f"## Source: {url}\n\n{pages[url][:page_chars]}" for url in batch
        )
        logger.info(
            "🧠 Lot %d/%d — %d fiche(s), %d caracteres",
            start // batch_size + 1,
            (len(urls) + batch_size - 1) // batch_size,
            len(batch),
            len(source),
        )

        def produce(text=source):
            started = time.time()
            result = extract_structured(
                system_prompt=prompt,
                source_text=text,
                json_schema=schema,
                min_tier=min_tier,
            )
            logger.info("   ↳ %.1f s", time.time() - started)
            return result

        try:
            payload, _ = _cached(cache_dir, "gemini", "gemini::" + "|".join(batch), produce)
        except (ExtractionUnavailable, RuntimeError, ValueError, OSError) as exc:
            logger.error("❌ Extraction ratee sur %s : %s", batch, exc)
            failures.append({"urls": batch, "error": str(exc)[:400]})
            continue

        if isinstance(payload, dict):
            merged["statements"].extend(payload.get("statements") or [])
            merged["policies"].extend(payload.get("policies") or [])

    return merged, failures


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sortie seche de la collecte campus <-> programme (aucune ecriture en base)"
    )
    parser.add_argument("--school-name", required=True)
    parser.add_argument("--domain", required=True, help="Domaine officiel, ex: www.em-normandie.com")
    parser.add_argument(
        "--campus",
        action="append",
        default=[],
        required=True,
        help="Campus REEL de l'ecole. Repeter l'option. C'est ce qui debloque `kind`.",
    )
    parser.add_argument("--catalog-url", default=None, help="Page catalogue, si connue")
    parser.add_argument(
        "--include-url",
        action="append",
        default=[],
        help="Fiche a lire imperativement, meme absente de la cartographie",
    )
    parser.add_argument(
        "--path-prefix",
        default=None,
        help="Ne garder que les URL dont le chemin commence par ce prefixe",
    )
    parser.add_argument("--limit", type=int, default=20, help="Nombre max de fiches lues")
    parser.add_argument("--batch-size", type=int, default=3, help="Fiches par appel Gemini")
    parser.add_argument("--page-chars", type=int, default=60000, help="Troncature par page")
    parser.add_argument("--out", default="tmp/dry", help="Repertoire de sortie")
    parser.add_argument("--cache-dir", default=None, help="Cache des reponses brutes")
    parser.add_argument(
        "--no-index",
        action="store_true",
        help="Ne pas lire les pages d'index (elles portent les cartes, plus riches que certaines fiches)",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("SORTIE SECHE — rattachement programme <-> lieu")
    print(f"Ecole   : {args.school_name} ({args.domain})")
    print(f"Campus  : {', '.join(args.campus)}")
    print("Ecriture en base : AUCUNE")
    print("=" * 60)

    key_manager = TavilyKeyManager()

    index_pages, fiches, credits = discover_urls(
        args.school_name,
        args.domain,
        key_manager,
        args.catalog_url,
        args.cache_dir,
        args.path_prefix,
    )

    forced = [u for u in args.include_url if u not in fiches]
    selected = forced + [u for u in fiches if u not in args.include_url]
    selected = selected[: args.limit]

    to_read = list(selected)
    if not args.no_index:
        to_read = index_pages + to_read

    logger.info("📥 Lecture de %d page(s) (%d index)", len(to_read), 0 if args.no_index else len(index_pages))
    pages = extract_pages(to_read, key_manager, args.cache_dir)
    logger.info("📄 %d page(s) rendues", len(pages))

    raw, failures = run_extraction(pages, args.batch_size, args.page_chars, args.cache_dir)
    rows = build_rows(raw, args.campus)

    rows["run"] = {
        "school": args.school_name,
        "domain": args.domain,
        "campuses_argument": args.campus,
        "index_pages": index_pages,
        "pages_read": sorted(pages),
        "pages_requested": to_read,
        "tavily_credits_this_run": credits,
        "extraction_failures": failures,
        "wrote_to_database": False,
    }

    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, f"{_slug(args.school_name)}.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(rows, handle, ensure_ascii=False, indent=2)

    print("\n" + "=" * 60)
    print(json.dumps(rows["totals"], ensure_ascii=False, indent=2))
    print(f"→ {path}")
    print("Aucune ligne ecrite en base, aucune migration appliquee.")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
