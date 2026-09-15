"""
Sortie seche de la collecte « ou se deroule ce programme ».

Ce script LIT le web et n'ecrit RIEN en base. Il produit, par ecole, un JSON
contenant les lignes qu'il ecrirait dans `ProgramCampus`,
`ProgramCampusAttachment` et `ProgramPlacement` — plus ce qu'il a rejete et ce
qui se contredit. La chaine d'appels est celle de la Phase 1 :
`backend/pipeline/campus_attachment_collector.py`.

## La liste des campus vient de la table `Campus`

Trois sources, une seule a la fois :

  * par defaut, la base elle-meme (`--school-id`, psycopg2, lecture seule) ;
  * `--db-dump` : le JSON de `scripts/dump-program-identity.ts`, la meme table
    lue en WebSocket depuis un poste ou le port 5432 est coupe ;
  * `--campus`, repete : la liste saisie a la main. Elle n'est plus acceptee
    qu'avec `--cache-only`, pour REJOUER le cache — jamais pour une collecte
    qui paie.

    python -m backend.scripts.simulate_campus_attachment \\
        --school-name "Em Lyon" --domain em-lyon.com \\
        --catalog-url "https://em-lyon.com/fr/nos-programmes" \\
        --db-dump tmp/db.json \\
        --limit 24 --batch-size 3 --cache-dir tmp/dry-cache --cache-only \\
        --out tmp/after-db

## Chaine d'appels

  /search  page catalogue (catalog_client.find_catalog_pages)
  /map     enracine sur cette page — jamais sur la racine du domaine
  /extract les pages d'index, puis les fiches, 5 URL par appel
  Gemini   schema Campus_Attachment, min_tier="low", plusieurs fiches par appel

Aucun appel /research. Toutes les reponses brutes sont mises en cache sur
disque : un second passage ne coute pas un credit, et le rapport est
rejouable. `--cache-only` interdit tout appel : une reponse absente du cache
fait echouer le rejeu au lieu d'etre payee.
"""

import argparse
import json
import logging
import os
import re
import sys

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

from backend.pipeline.campus_attachment_collector import (  # noqa: E402
    DEFAULT_BATCH_SIZE,
    DEFAULT_PAGE_CHARS,
    CachedCollectorIO,
    LiveCollectorIO,
    collect_campus_rows,
    read_school_snapshot,
    snapshot_from_dump,
)

logger = logging.getLogger("scripts.campus_attachment")


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return cleaned or "ecole"


def resolve_campus_source(args) -> tuple[list[str], dict]:
    """
    Rend `(noms de campus, provenance)`, ou leve SystemExit si la demande est
    incoherente. La provenance part dans le bloc `run` de la sortie.
    """
    if args.campus:
        if args.db_dump or args.school_id:
            raise SystemExit("--campus exclut --db-dump et --school-id : une seule source de campus.")
        if not args.cache_only:
            raise SystemExit(
                "--campus ne sert plus qu'a rejouer le cache : ajoutez --cache-only. "
                "Une collecte qui paie lit sa liste dans la table Campus."
            )
        return list(args.campus), {"kind": "argument"}

    if args.db_dump:
        with open(args.db_dump, encoding="utf-8") as handle:
            dump = json.load(handle)
        school = args.db_school or args.school_name
        try:
            snapshot = snapshot_from_dump(dump, school)
        except KeyError as exc:
            raise SystemExit(str(exc)) from None
        return snapshot.campus_names, {"kind": "db_dump", "path": args.db_dump, "school": snapshot.name}

    if args.school_id:
        import psycopg2.extras

        from backend.db import get_db_connection

        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                snapshot = read_school_snapshot(cur, args.school_id)
        if snapshot is None:
            raise SystemExit(f"Ecole introuvable en base : {args.school_id}")
        return snapshot.campus_names, {"kind": "database", "school": snapshot.name}

    raise SystemExit("Source de campus requise : --school-id, --db-dump, ou --campus avec --cache-only.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sortie seche de la collecte campus <-> programme (aucune ecriture en base)"
    )
    parser.add_argument("--school-name", required=True)
    parser.add_argument("--domain", required=True, help="Domaine officiel, ex: www.em-normandie.com")
    parser.add_argument("--school-id", default=None, help="Lire les campus en base (psycopg2)")
    parser.add_argument("--db-dump", default=None, help="Lire les campus dans le dump de dump-program-identity.ts")
    parser.add_argument("--db-school", default=None, help="Nom de l'ecole dans le dump, si different de --school-name")
    parser.add_argument(
        "--campus",
        action="append",
        default=[],
        help="Campus saisi a la main, repetable. Seulement avec --cache-only, pour rejouer le cache.",
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
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help="Fiches par appel Gemini")
    parser.add_argument("--page-chars", type=int, default=DEFAULT_PAGE_CHARS, help="Troncature par page")
    parser.add_argument("--out", default="tmp/dry", help="Repertoire de sortie")
    parser.add_argument("--cache-dir", default=None, help="Cache des reponses brutes")
    parser.add_argument(
        "--cache-only",
        action="store_true",
        help="Aucun appel Tavily ni Gemini : une reponse absente du cache fait echouer le rejeu",
    )
    parser.add_argument(
        "--no-index",
        action="store_true",
        help="Ne pas lire les pages d'index (elles portent les cartes, plus riches que certaines fiches)",
    )
    parser.add_argument(
        "--no-page-guards",
        action="store_true",
        help=(
            "Ne PAS confronter la sortie du modele aux pages lues. Sert a "
            "rejouer la sortie d'avant les gardes depuis le meme cache, donc a "
            "mesurer leur effet au lieu de l'annoncer."
        ),
    )
    args = parser.parse_args()

    if args.cache_only and not args.cache_dir:
        raise SystemExit("--cache-only demande --cache-dir.")

    campuses, campus_source = resolve_campus_source(args)

    print("=" * 60)
    print("SORTIE SECHE — rattachement programme <-> lieu")
    print(f"Ecole   : {args.school_name} ({args.domain})")
    print(f"Campus  : {', '.join(campuses)}  [{campus_source['kind']}]")
    print(f"Reseau  : {'AUCUN (cache seul)' if args.cache_only else 'Tavily + Gemini sur absence de cache'}")
    print("Ecriture en base : AUCUNE")
    print("=" * 60)

    if args.cache_only:
        io = CachedCollectorIO(args.cache_dir, inner=None, cache_only=True)
    else:
        from backend.tavily_service.key_manager import TavilyKeyManager

        live = LiveCollectorIO(TavilyKeyManager())
        io = CachedCollectorIO(args.cache_dir, inner=live) if args.cache_dir else live

    rows = collect_campus_rows(
        io,
        school_name=args.school_name,
        domain=args.domain,
        campuses=campuses,
        catalog_url=args.catalog_url,
        include_urls=args.include_url,
        path_prefix=args.path_prefix,
        limit=args.limit,
        batch_size=args.batch_size,
        page_chars=args.page_chars,
        read_index=not args.no_index,
        page_guards=not args.no_page_guards,
    )
    rows["run"]["campus_source"] = campus_source
    if isinstance(io, CachedCollectorIO):
        rows["run"]["calls"] = io.calls

    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, f"{_slug(args.school_name)}.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(rows, handle, ensure_ascii=False, indent=2)

    print("\n" + "=" * 60)
    print(json.dumps(rows["totals"], ensure_ascii=False, indent=2))
    if rows.get("campus_key_collisions"):
        print(f"!! campus replies sur une meme cle : {rows['campus_key_collisions']}")
    print(f"→ {path}")
    print("Aucune ligne ecrite en base, aucune migration appliquee.")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
