"""
Rejeu, sur cache seul, du pas « rattachement campus » de la Phase 1.

Ce script appelle `run_campus_attachment_step()` — la fonction meme que
`phase1_research.run_phase1_research()` appelle — pour chaque ecole du dump,
avec :

  * l'etat de la base lu dans le dump de `scripts/dump-program-identity.ts` ;
  * un reseau qui ne sert QUE le cache (`CacheMiss` sur toute absence) :
    0 credit Tavily, 0 appel Gemini ;
  * un depot de ticket qui ECRIT UN FICHIER au lieu d'inserer en base.

Il n'ecrit rien en base et ne s'y connecte pas.

    python -m backend.scripts.replay_phase1_campus_attachment \\
        --db-dump tmp/db.json --cache-dir tmp/dry-cache \\
        --catalog "Em Normandie=https://www.em-normandie.com/programmes" \\
        --catalog "Em Lyon=https://em-lyon.com/fr/nos-programmes" \\
        --include-url "Em Normandie=https://www.em-normandie.com/programmes/votre-formation-en-marketing-digital/ms-marketing-communication-et-ingenierie-des-produits-agroalimentaires" \\
        --state as-dumped --out tmp/phase1-replay

## Ce que le rejeu ne rejoue pas, et qu'il faut dire

  * La page catalogue : en Phase 1 elle vient de `fetch_catalog()` (/search),
    dont aucune reponse n'est en cache. `--catalog` la donne, telle que la
    collecte du 4 septembre l'a utilisee. Une ecole sans `--catalog` sort en
    `skipped / no_catalog_page` — c'est le cas d'EM Strasbourg, absente du cache.
  * La fiche forcee : la collecte d'EM Normandie avait lu une fiche absente de
    /map (`--include-url`). La Phase 1 ne la lirait pas ; sans elle, les lots
    /extract et Gemini different et ne sont pas en cache.

## Les trois etats

  * `as-dumped`    — la base telle que le dump la montre ;
  * `before-write` — les lignes-annees retirees de l'instantane : la base
                     d'avant l'ecriture du 15 septembre 2026 ;
  * `note-written` — les notes que cette collecte proposerait, deja posees :
                     la base d'apres la validation de ce ticket.
"""

import argparse
import json
import logging
import os
import re
import sys

sys.path.append(os.path.abspath("."))

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from backend.pipeline.attachment_plan import build_policy_note_claims  # noqa: E402
from backend.pipeline.campus_attachment_collector import (  # noqa: E402
    CachedCollectorIO,
    collect_campus_rows,
    run_campus_attachment_step,
    snapshot_from_dump,
)

STATES = ("as-dumped", "before-write", "note-written")


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-") or "ecole"


def _pairs(values: list[str], option: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for value in values:
        school, sep, url = value.partition("=")
        if not sep or not school.strip() or not url.strip():
            raise SystemExit(f"{option} attend « Ecole=URL », recu : {value!r}")
        out.setdefault(school.strip(), []).append(url.strip())
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Rejeu sur cache du rattachement campus de la Phase 1")
    parser.add_argument("--db-dump", required=True)
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--catalog", action="append", default=[], help="Ecole=URL de la page catalogue")
    parser.add_argument("--include-url", action="append", default=[], help="Ecole=URL d'une fiche forcee")
    parser.add_argument("--state", choices=STATES, default="as-dumped")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    with open(args.db_dump, encoding="utf-8") as handle:
        dump = json.load(handle)
    catalogs = _pairs(args.catalog, "--catalog")
    includes = _pairs(args.include_url, "--include-url")
    os.makedirs(args.out, exist_ok=True)

    summaries = []
    for school in dump:
        snapshot = snapshot_from_dump(dump, school["name"])
        index_pages = catalogs.get(snapshot.name, [])
        include = includes.get(snapshot.name, [])
        io = CachedCollectorIO(args.cache_dir, inner=None, cache_only=True)

        if args.state == "before-write":
            snapshot.attachments = []
        if args.state == "note-written" and snapshot.programs and index_pages:
            rows = collect_campus_rows(
                io, school_name=snapshot.name, domain=snapshot.official_domain,
                campuses=snapshot.campus_names, catalog_url=index_pages[0], include_urls=include,
            )
            notes, _ = build_policy_note_claims(rows["programs"], snapshot)
            posed = {n["programId"]: n["note"] for n in notes}
            for program in snapshot.programs:
                if program["id"] in posed:
                    program["campus_policy_note"] = posed[program["id"]]
            io = CachedCollectorIO(args.cache_dir, inner=None, cache_only=True)

        slug = _slug(snapshot.name)

        def emit(payload, urls, slug=slug):
            path = os.path.join(args.out, f"{slug}.{args.state}.ticket.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump({"urls": urls, "ai_extracted_json": payload}, handle, ensure_ascii=False, indent=1)
            return f"fichier:{path}"

        summary = run_campus_attachment_step(snapshot, io, index_pages, emit, include_urls=include)
        summary["network_calls"] = io.calls
        summaries.append(summary)

    path = os.path.join(args.out, f"summary.{args.state}.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(summaries, handle, ensure_ascii=False, indent=1)

    print(f"Etat : {args.state} — aucun appel reseau, aucune ecriture en base")
    for s in summaries:
        plan = s.get("plan") or {}
        att = plan.get("attachments") or {}
        notes = plan.get("policy_notes") or {}
        calls = {k: v.get("cached", 0) for k, v in (s.get("network_calls") or {}).items()}
        detail = (
            f"lignes {att.get('create', 0)}c/{att.get('update', 0)}u/{att.get('unchanged', 0)}=/"
            f"{att.get('stale', 0)}s, notes {notes.get('create', 0)}c/{notes.get('update', 0)}u/"
            f"{notes.get('unchanged', 0)}=, conflits {plan.get('conflicts', {})}"
            if plan else s.get("reason", "")
        )
        print(f"  {s['school']:<14} {s['status']:<15} ticket={s['ticket_id']}  {detail}  cache={calls}")
    print(f"→ {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
