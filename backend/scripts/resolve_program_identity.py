"""
Confrontation seche : les fiches du collecteur contre les `Program` reels.

Ce script n'ecrit RIEN en base. Il ne s'y connecte meme pas : il lit la sortie
seche de `simulate_campus_attachment.py` et le JSON produit par
`scripts/dump-program-identity.ts`, et il rend les lignes
`ProgramCampusAttachment` reellement ecrivables sur des aretes qui existent
deja — plus, nommement, tout ce qu'il refuse d'ecrire et pourquoi.

    npx tsx scripts/dump-program-identity.ts tmp/db.json

    python -m backend.scripts.resolve_program_identity \\
        --db-dump tmp/db.json \\
        --school "Em Normandie" --dry tmp/after/em-normandie.json \\
        --school "Em Lyon"      --dry tmp/after/em-lyon.json \\
        --out tmp/resolve

Aucun appel reseau, aucun credit Tavily, aucun appel Gemini : les deux entrees
sont des fichiers.

## Ce que « ecrivable » veut dire ici

Une ligne est ecrivable si, et seulement si :

  1. sa fiche s'apparie SANS AMBIGUITE a un `Program` de l'ecole ;
  2. son campus s'apparie a un `Campus` de l'ecole ;
  3. l'arete `ProgramCampus` entre les deux EXISTE DEJA en base ;
  4. sa cle `(programCampusId, study_year, regime)` n'est pas revendiquee par
     une autre fiche avec une charge differente.

Aucune de ces quatre conditions n'est forcee. Ce script ne cree ni `Program`,
ni `Campus`, ni `ProgramCampus` : creer une arete ouvre une option dans deux
ecrans d'admin, une destination de capacite et une tache Capacity facturee en
Phase 2. Ce chemin passe par `validateProgramDiscovery` et par la validation
humaine.
"""

import argparse
import json
import os
import sys

sys.path.append(os.path.abspath("."))

from backend.pipeline.program_identity import (  # noqa: E402
    MATCH_ABSENT,
    resolve_attachment_rows,
)


def _load(path: str) -> object:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def _school_of(dump: list, name: str) -> dict:
    for school in dump:
        if school.get("name") == name:
            return school
    known = ", ".join(sorted(s.get("name", "?") for s in dump))
    raise SystemExit(f"Ecole absente du dump : {name!r}. Presentes : {known}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db-dump", required=True,
                        help="JSON de scripts/dump-program-identity.ts")
    parser.add_argument("--school", action="append", required=True,
                        help="Nom de l'ecole en base, repetable")
    parser.add_argument("--dry", action="append", required=True,
                        help="Sortie seche de simulate_campus_attachment, repetable")
    parser.add_argument("--out", default=None,
                        help="Dossier ou ecrire un JSON par ecole")
    args = parser.parse_args()

    if len(args.school) != len(args.dry):
        raise SystemExit("Il faut autant de --dry que de --school.")

    dump = _load(args.db_dump)
    if args.out:
        os.makedirs(args.out, exist_ok=True)

    grand_total = {"produced": 0, "writable": 0, "merged": 0}

    for school_name, dry_path in zip(args.school, args.dry):
        school = _school_of(dump, school_name)
        dry = _load(dry_path)
        result = resolve_attachment_rows(
            fiches=dry.get("programs") or [],
            programs=school.get("programs") or [],
            campuses=school.get("campuses") or [],
            edges=school.get("edges") or [],
        )
        totals = result["totals"]

        print("=" * 78)
        print(f"{school_name} — {totals['fiches']} fiches contre "
              f"{totals['programs_in_db']} Program, {totals['campuses_in_db']} Campus, "
              f"{totals['edges_in_db']} aretes")
        if result["canonical_collisions"]:
            print("  !! la forme canonique fusionne des Program reels :")
            for key, names in result["canonical_collisions"].items():
                print(f"       {key} <- {names}")
        else:
            print("  forme canonique : aucune collision entre Program de la base")

        print("\n  Appariement fiche -> Program, par clause")
        for clause, count in totals["clauses"].items():
            print(f"     {clause:<12} {count:>3}")

        unmatched = [m for m in result["matches"] if m["clause"] != MATCH_ABSENT
                     and m["program_id"] is None]
        absent = [m for m in result["matches"] if m["clause"] == MATCH_ABSENT]
        if absent:
            print(f"\n  Non apparies — aucun Program de cette ecole ({len(absent)}) :")
            for m in absent:
                suffix = f"   [{m['attachment_rows']} lignes-annees]" if m["attachment_rows"] else ""
                print(f"     - {m['fiche']}{suffix}")
        if unmatched:
            print(f"\n  Ambigus — plusieurs Program repondent ({len(unmatched)}) :")
            for m in unmatched:
                print(f"     - {m['fiche']} -> {' / '.join(m['candidates'])}")

        print(f"\n  Lignes-annees : {totals['attachment_rows_produced']} produites, "
              f"{totals['attachment_rows_writable']} ecrivables "
              f"({totals['attachment_rows_merged']} fusionnees a l'identique)")
        for row in result["writable_attachments"]:
            fiches = f"   <- {len(row['_fiches'])} fiches" if len(row["_fiches"]) > 1 else ""
            print(f"     {row['program']} + {row['campus']} / annee {row['study_year']}"
                  f" / {row['regime']} / {','.join(row['languages']) or '-'}{fiches}")

        if totals["conflicts"]:
            print("\n  Conflits, par type")
            for kind, count in totals["conflicts"].items():
                print(f"     {kind:<22} {count:>3}")
            for conflict in result["conflicts"]:
                print(f"     · {json.dumps(conflict, ensure_ascii=False)}")

        grand_total["produced"] += totals["attachment_rows_produced"]
        grand_total["writable"] += totals["attachment_rows_writable"]
        grand_total["merged"] += totals["attachment_rows_merged"]

        if args.out:
            slug = school_name.lower().replace(" ", "-")
            path = os.path.join(args.out, f"{slug}.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(result, handle, ensure_ascii=False, indent=1)
            print(f"\n  ecrit : {path}")

    print("=" * 78)
    print(f"TOTAL : {grand_total['produced']} lignes-annees produites, "
          f"{grand_total['writable']} ecrivables sur des aretes existantes, "
          f"{grand_total['merged']} affirmations fusionnees a l'identique")
    print("Aucune ecriture en base. Aucune arete creee. Aucune migration appliquee.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
