"""
backend/pipeline/attachment_plan.py — Ce qu'un ticket de rattachement ecrirait, calcule avant de le deposer

Ce module ne parle a personne : ni reseau, ni base, ni Gemini. Il fait deux
choses, et seulement deux.

**1. Construire la charge du ticket.** Des fiches rendues par
`campus_attachment.build_rows()` aux affirmations `campus_attachments` et
`campus_policy_notes`, avec les `programId` et `campusId` REELS : l'appariement
est celui de `program_identity.py`, deja prouve (clauses A1, A2, B, et
`fold_campus_name` des deux cotes). Une ligne dont le programme ou le campus ne
se resout pas n'entre PAS dans la charge : elle est rendue a part, nommee.

**2. Calculer le plan de la route, pour decider s'il faut deposer le ticket.**
La garde contre l'inondation de l'Inbox est « n'emettre de ticket que si le
plan a quelque chose a creer ou a mettre a jour ». Le plan qui fait foi est
celui de `lib/campus-attachment.ts`, que la route execute au moment d'ecrire.
La Phase 1 est en Python et n'a aucun canal vers l'application Next : ce
fichier en est donc le PORTAGE, regle pour regle et dans le meme ordre —
lecture, absorption ANY, fusion des voies, resolution des aretes, confrontation
a la table.

Deux implementations d'une meme comparaison divergent un jour si rien ne les
tient. Elles sont tenues par `test/fixtures/attachment_plan_cases.json`, lu par
`test/test_attachment_plan.py` ET par `test/campus-attachment.test.ts` : chaque
cas y fixe le plan attendu, et les deux suites doivent le rendre. Le portage ne
decide jamais d'une ecriture : il decide seulement si un ticket merite d'etre
montre. S'il se trompait, le pire serait un ticket qui n'ecrit rien (visible),
ou un ticket non emis que la passe suivante emettra.

## Les notes de politique de campus

`Program.campus_policy_note` a desormais un chemin d'ecriture, par la meme
route et le meme ticket : la phrase que la fiche pose au-dessus de la liste par
annee (l'IBBA). Une note ne cree ni `Program` ni `Campus`, n'efface jamais une
note existante, et deux fiches d'un meme programme qui en publient deux
differentes n'ecrivent rien.
"""

from __future__ import annotations

import json
from typing import Any, Iterable, Optional

from backend.pipeline.campus_attachment import fold_campus_name
from backend.pipeline.program_identity import match_program

ATTACHMENT_REGIMES = ("ANY", "INITIAL", "ALTERNANCE")


# ── 1. La charge du ticket ────────────────────────────────────────


def _campus_index(campuses: Iterable[dict]) -> dict[str, Optional[dict]]:
    """Cle `fold_campus_name` -> campus, ou None si deux campus s'y replient."""
    index: dict[str, Optional[dict]] = {}
    for campus in campuses:
        key = fold_campus_name(campus.get("name"))
        if not key:
            continue
        index[key] = None if key in index else campus
    return index


def build_attachment_claims(fiches: list[dict], snapshot) -> tuple[list[dict], list[dict]]:
    """
    Les lignes-annees des fiches, en affirmations resolues sur la base.

    Rend `(claims, unresolved)`. Une affirmation porte `programId` et
    `campusId` REELS ; `program` et `campus` sont les noms de la base, pour
    l'affichage ; `fiche` est l'intitule publie. Rien n'est devine : une fiche
    qui ne s'apparie pas a exactement un `Program`, ou un campus qui ne se
    resout pas, part dans `unresolved` avec sa raison.
    """
    campus_by_key = _campus_index(snapshot.campuses)
    claims: list[dict] = []
    unresolved: list[dict] = []

    for fiche in fiches:
        rows = fiche.get("program_campus_attachment") or []
        if not rows:
            continue
        clause, hits = match_program(fiche.get("program") or "", snapshot.programs)
        program = hits[0] if len(hits) == 1 else None
        for row in rows:
            campus = campus_by_key.get(fold_campus_name(row.get("campusName")))
            if program is None or campus is None:
                unresolved.append({
                    "reason": "program_unmatched" if program is None else "campus_unmatched",
                    "clause": clause,
                    "fiche": fiche.get("program"),
                    "campus": row.get("campusName"),
                    "study_year": row.get("study_year"),
                    "regime": row.get("regime"),
                })
                continue
            claims.append({
                "programId": program["id"],
                "campusId": campus["id"],
                "program": program["name"],
                "campus": campus["name"],
                "fiche": fiche.get("program"),
                "study_year": row.get("study_year"),
                "regime": row.get("regime"),
                "languages": list(row.get("languages") or []),
                "note": row.get("note"),
                "source_url": row.get("source_url"),
            })
    return claims, unresolved


def build_policy_note_claims(fiches: list[dict], snapshot) -> tuple[list[dict], list[dict]]:
    """Les notes de politique de campus, sur des `Program` resolus. Rend `(notes, unresolved)`."""
    notes: list[dict] = []
    unresolved: list[dict] = []
    for fiche in fiches:
        note = (fiche.get("campus_policy_note") or "").strip()
        if not note:
            continue
        clause, hits = match_program(fiche.get("program") or "", snapshot.programs)
        if len(hits) != 1:
            unresolved.append({"reason": "program_unmatched", "clause": clause, "fiche": fiche.get("program")})
            continue
        notes.append({
            "programId": hits[0]["id"],
            "program": hits[0]["name"],
            "fiche": fiche.get("program"),
            "note": note,
        })
    return notes, unresolved


# ── 2. Le plan — portage de lib/campus-attachment.ts ──────────────


def _clean_text(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed or None


def normalize_languages(values: Any) -> list[str]:
    """`normalizeLanguages` : un tableau seulement, codes majuscules, dedoublonnes, tries."""
    if not isinstance(values, list):
        return []
    return sorted({v.strip().upper() for v in values if isinstance(v, str) and v.strip()})


def _is_whole_number(value: Any) -> bool:
    """`Number.isInteger` : un booleen n'est pas un nombre, 3.0 en est un."""
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    return isinstance(value, float) and value.is_integer()


def _payload_of(row: dict) -> str:
    """Ce qu'une ligne AFFIRME. `source_url` en est exclu : il dit qui l'a publie."""
    return json.dumps([row["languages"], row["note"]], ensure_ascii=False)


def parse_attachment_claims(raw: Any) -> tuple[list[dict], list[dict]]:
    """`parseAttachmentClaims`."""
    conflicts: list[dict] = []
    claims: list[dict] = []
    container = raw if isinstance(raw, dict) else {}
    rows = container.get("campus_attachments")
    rows = rows if isinstance(rows, list) else []

    for index, entry in enumerate(rows):
        if not isinstance(entry, dict):
            conflicts.append({"type": "malformed_row", "detail": f"entrée {index} : objet attendu"})
            continue
        program_id = _clean_text(entry.get("programId"))
        campus_id = _clean_text(entry.get("campusId"))
        labels = {
            "program": _clean_text(entry.get("program")),
            "campus": _clean_text(entry.get("campus")),
            "fiche": _clean_text(entry.get("fiche")),
        }
        if not program_id or not campus_id:
            conflicts.append({"type": "unresolved_reference", **labels})
            continue
        study_year = entry.get("study_year")
        if not _is_whole_number(study_year) or study_year < 1:
            conflicts.append({"type": "malformed_row", **labels, "detail": "study_year"})
            continue
        regime = entry.get("regime")
        if regime is None:
            regime = "ANY"
        if regime not in ATTACHMENT_REGIMES:
            conflicts.append({"type": "malformed_row", **labels, "detail": "regime"})
            continue
        claims.append({
            "programId": program_id,
            "campusId": campus_id,
            "study_year": int(study_year),
            "regime": regime,
            "languages": normalize_languages(entry.get("languages")),
            "note": _clean_text(entry.get("note")),
            "source_url": _clean_text(entry.get("source_url")),
            **labels,
        })
    return claims, conflicts


def absorb_any_regime_claims(claims: list[dict]) -> tuple[list[dict], list[dict]]:
    """`absorbAnyRegime` : ANY et un regime nomme ne coexistent pas sur une annee."""
    buckets: dict[tuple, list[dict]] = {}
    for claim in claims:
        buckets.setdefault((claim["programId"], claim["campusId"], claim["study_year"]), []).append(claim)

    kept: list[dict] = []
    conflicts: list[dict] = []
    for bucket in buckets.values():
        any_rows = [c for c in bucket if c["regime"] == "ANY"]
        specific = [c for c in bucket if c["regime"] != "ANY"]
        if not any_rows or not specific:
            kept.extend(bucket)
            continue
        poured = normalize_languages([lang for c in any_rows for lang in c["languages"]])
        for row in specific:
            kept.append({**row, "languages": normalize_languages(row["languages"] + poured)})
        conflicts.append({
            "type": "absorbed_any",
            "program": any_rows[0]["program"],
            "campus": any_rows[0]["campus"],
            "fiche": any_rows[0]["fiche"],
            "study_year": any_rows[0]["study_year"],
            "regime": "ANY",
        })
    return kept, conflicts


def fold_tracks(claims: list[dict]) -> tuple[list[dict], list[dict]]:
    """`foldTracks` : deux affirmations qui concordent en font une, deux qui divergent aucune."""
    buckets: dict[tuple, list[dict]] = {}
    for claim in claims:
        key = (claim["programId"], claim["campusId"], claim["study_year"], claim["regime"])
        buckets.setdefault(key, []).append(claim)

    kept: list[dict] = []
    conflicts: list[dict] = []
    for bucket in buckets.values():
        first = bucket[0]
        if len(bucket) == 1:
            kept.append(first)
            continue
        fiches = sorted({c["fiche"] for c in bucket if c["fiche"]})
        common = {
            "program": first["program"],
            "campus": first["campus"],
            "fiches": fiches,
            "study_year": first["study_year"],
            "regime": first["regime"],
        }
        if len({_payload_of(c) for c in bucket}) > 1:
            conflicts.append({"type": "track_disagreement", **common})
            continue
        source_urls = sorted({c["source_url"] for c in bucket if c["source_url"]})
        kept.append({**first, "source_url": source_urls[0] if source_urls else None})
        conflicts.append({"type": "merged_tracks", **common})
    return kept, conflicts


def resolve_attachment_edges(claims: list[dict], edges: Iterable[dict]) -> tuple[list[dict], list[dict]]:
    """`resolveAttachmentEdges`, sur les aretes de l'instantane au lieu de `findUnique`."""
    by_pair = {(e["programId"], e["campusId"]): e["id"] for e in edges}
    resolved: list[dict] = []
    conflicts: list[dict] = []
    for claim in claims:
        edge_id = by_pair.get((claim["programId"], claim["campusId"]))
        if edge_id is None:
            conflicts.append({
                "type": "edge_missing",
                "program": claim["program"],
                "campus": claim["campus"],
                "fiche": claim["fiche"],
                "study_year": claim["study_year"],
                "regime": claim["regime"],
            })
            continue
        resolved.append({**claim, "programCampusId": edge_id})
    return resolved, conflicts


def plan_attachment_writes(resolved: list[dict], existing: Iterable[dict]) -> dict:
    """`planAttachmentWrites` : create, update, unchanged, stale, conflicts. Ne supprime rien."""
    existing = list(existing)
    plan: dict[str, list] = {"create": [], "update": [], "unchanged": [], "stale": [], "conflicts": []}

    existing_by_key = {(r["programCampusId"], r["study_year"], r["regime"]): r for r in existing}
    kinds_by_year: dict[tuple, set[str]] = {}
    for row in existing:
        kinds_by_year.setdefault((row["programCampusId"], row["study_year"]), set()).add(
            "ANY" if row["regime"] == "ANY" else "SPECIFIC"
        )

    affirmed: set[tuple] = set()
    touched: set[str] = set()
    for claim in resolved:
        touched.add(claim["programCampusId"])
        year_key = (claim["programCampusId"], claim["study_year"])
        row_key = (*year_key, claim["regime"])
        previous = existing_by_key.get(row_key)

        other_kinds = set(kinds_by_year.get(year_key, set()))
        if previous is not None:
            other_kinds.discard("ANY" if previous["regime"] == "ANY" else "SPECIFIC")
        incoming = "ANY" if claim["regime"] == "ANY" else "SPECIFIC"
        opposite = "SPECIFIC" if incoming == "ANY" else "ANY"
        if opposite in other_kinds:
            plan["conflicts"].append({
                "type": "regime_conflict",
                "program": claim["program"],
                "campus": claim["campus"],
                "fiche": claim["fiche"],
                "study_year": claim["study_year"],
                "regime": claim["regime"],
            })
            continue

        affirmed.add(row_key)
        write = {
            "programCampusId": claim["programCampusId"],
            "study_year": claim["study_year"],
            "regime": claim["regime"],
            "languages": claim["languages"],
            "note": claim["note"],
            "source_url": claim["source_url"],
            "program": claim["program"],
            "campus": claim["campus"],
            "fiches": [claim["fiche"]] if claim["fiche"] else [],
        }
        if previous is None:
            plan["create"].append(write)
            continue
        before = {
            "languages": normalize_languages(previous.get("languages")),
            "note": previous.get("note"),
        }
        # `previous.source_url ?? null` : seul l'absent devient null, une chaine
        # vide reste une valeur et differe donc de toute URL affirmee.
        previous_source = previous.get("source_url")
        if _payload_of(before) == _payload_of(write) and previous_source == write["source_url"]:
            plan["unchanged"].append(write)
            continue
        plan["update"].append({**write, "before": {**before, "source_url": previous_source}})

    labels = {c["programCampusId"]: (c["program"], c["campus"]) for c in resolved}
    for row in existing:
        if row["programCampusId"] not in touched:
            continue
        if (row["programCampusId"], row["study_year"], row["regime"]) in affirmed:
            continue
        program, campus = labels.get(row["programCampusId"], (None, None))
        plan["stale"].append({
            "id": row["id"],
            "programCampusId": row["programCampusId"],
            "study_year": row["study_year"],
            "regime": row["regime"],
            "languages": normalize_languages(row.get("languages")),
            "program": program,
            "campus": campus,
        })
    return plan


def parse_policy_note_claims(raw: Any) -> tuple[list[dict], list[dict]]:
    """`parsePolicyNoteClaims`."""
    conflicts: list[dict] = []
    claims: list[dict] = []
    container = raw if isinstance(raw, dict) else {}
    rows = container.get("campus_policy_notes")
    rows = rows if isinstance(rows, list) else []
    for index, entry in enumerate(rows):
        if not isinstance(entry, dict):
            conflicts.append({"type": "malformed_row", "detail": f"note {index} : objet attendu"})
            continue
        labels = {"program": _clean_text(entry.get("program")), "fiche": _clean_text(entry.get("fiche"))}
        program_id = _clean_text(entry.get("programId"))
        if not program_id:
            conflicts.append({"type": "unresolved_reference", **labels})
            continue
        note = _clean_text(entry.get("note"))
        if not note:
            conflicts.append({"type": "malformed_row", **labels, "detail": "note"})
            continue
        claims.append({"programId": program_id, "note": note, **labels})
    return claims, conflicts


def fold_policy_notes(claims: list[dict]) -> tuple[list[dict], list[dict]]:
    """`foldPolicyNotes` : une meme phrase pour un programme en fait une, deux phrases aucune."""
    buckets: dict[str, list[dict]] = {}
    for claim in claims:
        buckets.setdefault(claim["programId"], []).append(claim)
    kept: list[dict] = []
    conflicts: list[dict] = []
    for bucket in buckets.values():
        first = bucket[0]
        if len(bucket) == 1:
            kept.append(first)
            continue
        fiches = sorted({c["fiche"] for c in bucket if c["fiche"]})
        if len({c["note"] for c in bucket}) > 1:
            conflicts.append({"type": "note_disagreement", "program": first["program"], "fiches": fiches})
            continue
        kept.append(first)
        conflicts.append({"type": "merged_notes", "program": first["program"], "fiches": fiches})
    return kept, conflicts


def plan_policy_note_writes(claims: list[dict], programs: Iterable[dict], school_id: Optional[str]) -> dict:
    """
    `resolvePolicyNotePrograms` puis `planPolicyNoteWrites`.

    Un programme absent, ou d'une autre ecole, n'ecrit rien. Une note en base
    identique est `unchanged` ; differente, `update` avec l'avant. Jamais
    d'effacement : une fiche qui ne publie plus de note ne touche a rien.
    """
    by_id = {p["id"]: p for p in programs}
    plan: dict[str, list] = {"create": [], "update": [], "unchanged": [], "conflicts": []}
    for claim in claims:
        program = by_id.get(claim["programId"])
        if program is None:
            plan["conflicts"].append({"type": "program_missing", "program": claim["program"], "fiche": claim["fiche"]})
            continue
        if program.get("schoolId", school_id) != school_id:
            plan["conflicts"].append({"type": "program_outside_school", "program": claim["program"], "fiche": claim["fiche"]})
            continue
        write = {"programId": claim["programId"], "note": claim["note"], "program": claim["program"], "fiche": claim["fiche"]}
        current = program.get("campus_policy_note")
        if current is None:
            plan["create"].append(write)
        elif current == claim["note"]:
            plan["unchanged"].append(write)
        else:
            plan["update"].append({**write, "before": current})
    return plan


def plan_ticket_writes(raw: Any, snapshot, school_id: Optional[str] = None) -> dict:
    """
    Le plan complet d'un ticket, tel que la route le calculerait sur cet etat.

    `writes` = lignes-annees a creer ou mettre a jour + notes a creer ou
    mettre a jour. Zero : le ticket n'a rien a montrer, il n'est pas depose.
    """
    school_id = school_id if school_id is not None else getattr(snapshot, "school_id", None)

    parsed, parse_conflicts = parse_attachment_claims(raw)
    absorbed, absorb_conflicts = absorb_any_regime_claims(parsed)
    folded, fold_conflicts = fold_tracks(absorbed)
    resolved, edge_conflicts = resolve_attachment_edges(folded, snapshot.edges)
    attachments = plan_attachment_writes(resolved, snapshot.attachments)

    parsed_notes, note_parse_conflicts = parse_policy_note_claims(raw)
    folded_notes, note_fold_conflicts = fold_policy_notes(parsed_notes)
    notes = plan_policy_note_writes(folded_notes, snapshot.programs, school_id)

    conflicts = [
        *parse_conflicts, *absorb_conflicts, *fold_conflicts, *edge_conflicts, *attachments["conflicts"],
        *note_parse_conflicts, *note_fold_conflicts, *notes["conflicts"],
    ]
    counts = {
        "attachments": {k: len(attachments[k]) for k in ("create", "update", "unchanged", "stale")},
        "policy_notes": {k: len(notes[k]) for k in ("create", "update", "unchanged")},
        "conflicts": _count_types(conflicts),
    }
    writes = (
        counts["attachments"]["create"] + counts["attachments"]["update"]
        + counts["policy_notes"]["create"] + counts["policy_notes"]["update"]
    )
    return {"attachments": attachments, "policy_notes": notes, "conflicts": conflicts, "counts": counts, "writes": writes}


def _count_types(conflicts: list[dict]) -> dict[str, int]:
    out: dict[str, int] = {}
    for conflict in conflicts:
        out[conflict["type"]] = out.get(conflict["type"], 0) + 1
    return dict(sorted(out.items()))
