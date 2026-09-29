"""
backend/pipeline/discovery_diff.py — Ce que la Phase 1 découvre de NOUVEAU

Ce module ne parle à personne : ni réseau, ni base. Il prend les campus rendus
par la découverte (sortie de `_clean_extracted`) et les `Campus`, `Program` et
`ProgramCampus` réels de l'école, et il ne garde que ce que la base n'a pas.

## Pourquoi

Relancée sur une école déjà cartographiée, la Phase 1 rendait un ticket avec
TOUS les programmes. Et `validateProgramDiscovery` fait un `upsert` sur
`(schoolId, name)` exact : « Programme Grande Ecole » au lieu de « Programme
Grande École » créait un second `Program`, que la Phase 2 cherchait et payait
ensuite.

**La réécriture est ce qui empêche les doublons.** Un campus ou un programme
reconnu est réécrit à l'orthographe de la base : l'upsert retombe alors sur la
ligne existante.

## Les règles d'appariement — celles du dépôt, rien de neuf

  * **Campus** : `fold_campus_name()` des deux côtés. Une correspondance →
    réécrit ; aucune → nouveau ; plusieurs → gardé tel quel, signalé dans
    `ambiguous_campuses`.
  * **Programme** : `match_program()`. Clause `A1`, `A2` ou `B` → réécrit ;
    `ABSENT` → nouveau ; `AMBIGU/…` → gardé tel quel et signalé dans
    `ambiguous_programs`. Jamais d'appariement deviné.

## Ce qui reste

Un couple (campus, programme) est gardé si le campus est nouveau (ou ambigu),
si le programme est nouveau (ou ambigu), ou si l'arête `(programId, campusId)`
n'existe pas encore. Deux programmes découverts qui retombent sur le même
`Program` d'un même campus (deux voies d'accès du PGE) n'en font qu'un : le
premier rendu est gardé. Un campus sans programme restant est retiré.

Hors périmètre : les changements d'attributs d'un programme existant
(`admission_exam`, alternance…) et les programmes que le site ne publie plus.

Référence : docs/features/cron-rotation-production.md, étape 2.
"""

from __future__ import annotations

from typing import Any

from backend.pipeline.campus_attachment import fold_campus_name
from backend.pipeline.program_identity import MATCH_ABSENT, MATCH_AMBIGUOUS, match_program


def filter_new_discoveries(
    discovered_campuses: list[dict],
    campuses: list[dict],
    programs: list[dict],
    edges: set[tuple[str, str]],
) -> tuple[list[dict], dict]:
    """
    Les campus découverts réduits à ce qui manque en base, et le résumé du tri.

    `campuses` et `programs` : dicts `{id, name}` de l'école.
    `edges` : couples `(programId, campusId)` des `ProgramCampus` existants.

    Rien n'est modifié en place. Base vide : la sortie est égale à l'entrée.
    """
    campuses_by_key: dict[str, list[dict]] = {}
    for campus in campuses:
        campuses_by_key.setdefault(fold_campus_name(campus["name"]), []).append(campus)

    kept_campuses: list[dict] = []
    known_campus_ids: set[str] = set()
    known_program_ids: set[str] = set()
    pairs_in_base: set[tuple[str, str]] = set()
    ambiguous_campuses: list[dict] = []
    ambiguous_programs: list[dict] = []
    # (campus, programme) déjà émis : l'id de base quand il est connu, sinon le
    # nom tel qu'écrit.
    emitted: set[tuple[str, str]] = set()

    for discovered in discovered_campuses:
        key = fold_campus_name(discovered["name"])
        hits = campuses_by_key.get(key, []) if key else []
        db_campus = hits[0] if len(hits) == 1 else None
        if db_campus is not None:
            known_campus_ids.add(db_campus["id"])
        elif len(hits) > 1:
            ambiguous_campuses.append({
                "name": discovered["name"],
                "candidates": sorted(c["name"] for c in hits),
            })
        campus_name = db_campus["name"] if db_campus else discovered["name"]
        campus_identity = db_campus["id"] if db_campus else campus_name

        kept_programs: list[dict] = []
        for program in discovered.get("programs") or []:
            clause, program_hits = match_program(program["name"], programs)
            db_program = None
            if clause.startswith(MATCH_AMBIGUOUS):
                ambiguous_programs.append({
                    "name": program["name"],
                    "campus": campus_name,
                    "candidates": sorted(p["name"] for p in program_hits),
                })
            elif clause != MATCH_ABSENT:
                db_program = program_hits[0]
                known_program_ids.add(db_program["id"])
            program_name = db_program["name"] if db_program else program["name"]

            if db_campus and db_program:
                pair = (db_program["id"], db_campus["id"])
                if pair in edges:
                    pairs_in_base.add(pair)
                    continue

            identity = (campus_identity, db_program["id"] if db_program else program_name)
            if identity in emitted:
                continue
            emitted.add(identity)

            kept_programs.append({**program, "name": program_name})

        if kept_programs:
            kept_campuses.append({**discovered, "name": campus_name, "programs": kept_programs})

    summary: dict[str, Any] = {
        "campuses_known": len(known_campus_ids),
        "programs_known": len(known_program_ids),
        "pairs_already_in_base": len(pairs_in_base),
        "ambiguous_programs": ambiguous_programs,
        "ambiguous_campuses": ambiguous_campuses,
    }
    return kept_campuses, summary
