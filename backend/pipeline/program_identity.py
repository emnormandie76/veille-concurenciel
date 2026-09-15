"""
backend/pipeline/program_identity.py — De la fiche du site au `Program` de la base

Ce module ne parle a personne : ni reseau, ni base, ni Gemini. Il prend les
fiches produites par `campus_attachment.build_rows()`, la liste des `Program`,
`Campus` et `ProgramCampus` REELS d'une ecole, et il rend les lignes
`ProgramCampusAttachment` que l'on ecrirait — plus, nommement, tout ce qu'il
refuse d'ecrire et pourquoi.

Il n'est branche nulle part. `backend/scripts/resolve_program_identity.py` est
son seul appelant, et il ecrit un fichier JSON.

## Le probleme, mesure avant d'etre traite

Sur les 49 fiches du 4 septembre, AUCUNE des 33 lignes-annees ne se resolvait
et AUCUN nom de programme ne correspondait entre le site et la base. Deux
causes, de nature tres differente :

**Convention d'ecriture.** La base ecrit `Master of Science (MSc) - Banking,
Finance and FinTech`, le site `MSc Banking, Finance and FinTech` ; la base
`International Bachelor in Business Administration`, le site
`IBBA (International Bachelor in Business Administration)`. C'est franchissable
et ce fichier le franchit — clauses A1 et A2.

**Granularite.** La base a UN `Programme Grande Ecole` ; le site publie TROIS
fiches (en 5 ans, en 2 ou 3 ans, en blended learning). Idem pour
`Bachelor Management`. Ces deux familles portent 29 des 33 lignes-annees. Ce
n'est pas un probleme d'appariement : les deux cotes ont raison, ils ne
decoupent simplement pas au meme endroit. Le site decoupe par VOIE D'ACCES
(post-bac, admission sur titre, blended), la base par DIPLOME.

## Les quatre regles que ce fichier applique

**1. `fold_campus_name` — la cle d'un campus, des deux cotes.**

Definie dans `campus_attachment.py`, qui s'en sert depuis que la liste des
campus du collecteur vient de la table `Campus`, et reexportee ici : le
collecteur et l'appariement lisent un nom de campus par la meme porte.

`fold_label()` replie deja les accents et la casse. Il ne suffit pas ici, pour
deux raisons mesurees sur la base reelle :

  * la base ecrit `Campus Saint-Etienne` avec un trait d'union INSECABLE
    (U+2011). NFD ne le decompose pas — ce n'est pas un diacritique — donc
    aucun repli d'accents ne le rattrape. Toute la plage U+2010..U+2015 plus
    U+2212 est ramenee au tiret ASCII ;
  * les campus d'Em Lyon portent le mot « campus » DANS leur nom, devant
    (`Campus Bhubaneswar`) comme derriere (`Lyon campus`), la ou le site ecrit
    `Lyon` tout court. Le mot est donc retire aux DEUX bords.

Mesure : 12 noms de campus sur 12 se resolvent, 0 ambigu, 0 absent.

**2. `canon_program_name` — la forme canonique d'un nom de programme.**

Repli de `fold_label`, puis : tirets et apostrophes unifies, la tete de
diplome `Master of Science (MSc) -` ramenee a `msc`, toute ponctuation
ramenee a l'espace, et les mots de liaison retires. `and` et `et` sont dans
les mots de liaison : la base ecrit `Healthcare Innovation and Data Science`,
le site `Healthcare Innovation & Data Science`. Les retirer des deux cotes est
plus sur qu'une table `&` -> `and`, et c'est le seul cas du corpus.

Garde-fou : la forme canonique ne doit fusionner aucun couple de `Program`
d'une meme ecole. `check_canonical_collisions()` le verifie, et le script
l'appelle avant tout appariement. Verifie sur les 39 `Program` des deux
ecoles : aucune collision.

**3. `match_program` — trois clauses, et le silence plutot que l'a-peu-pres.**

  * A1 · identite   — les formes canoniques sont egales. 26 fiches sur 49.
  * A2 · sigle      — les jetons en trop d'un cote forment EXACTEMENT
                      l'acronyme des initiales de l'autre. 1 fiche sur 49
                      (l'IBBA). La clause se verifie elle-meme : l'acronyme
                      est derive du nom qu'il apparie, il n'y a pas de table.
  * B  · variante   — les jetons en trop appartiennent tous a une liste
                      FERMEE de qualificatifs de MODALITE (durees, alternance,
                      blended learning). 6 fiches sur 49. C'est la clause qui
                      NOMME la granularite : elle n'apparie pas au hasard, elle
                      dit « cette fiche est une variante de ce diplome ».

A chaque clause, si PLUSIEURS `Program` repondent, rien n'est apparie et le cas
est rendu `AMBIGU`. Un non-apparie se voit ; un mauvais appariement, non.

Pourquoi une liste fermee de modalites, et pas un ecart de jetons quelconque :
`Bachelor Management, Data et IA Responsables` porte `Bachelor Management`
comme sous-ensemble strict. C'est un autre diplome. Ses jetons en trop
(`data`, `ia`, `responsables`) ne sont pas des modalites, donc la clause B ne
le prend pas — il ressort `ABSENT`, ce qui est la bonne reponse. Le
`_match_program_name` du pipeline crowdsourcing, lui, l'attache a
`Bachelor Management` par inclusion de sous-chaine.

**4. `resolve_attachment_rows` — la fusion a l'identique.**

Plusieurs fiches d'un meme `Program` peuvent produire la MEME cle
`(programCampusId, study_year, regime)`. Sur ce corpus : 5 cles, chacune
publiee par les deux fiches PGE — l'annee 3 de Caen, Dubai, Dublin, Oxford et
Paris.

Ces 5 cas ne sont pas des contradictions, ce sont des REPETITIONS : les deux
fiches donnent les memes `languages` et la meme `note`. C'est logique — la 3e
annee du PGE a Caen est la meme annee du meme diplome, que l'etudiant y soit
entre en 1re annee ou sur titre.

Regle : on regroupe par cle resolue.

  * charge identique (memes `languages`, meme `note`) -> UNE ligne. Le
    `source_url` retenu est le premier par ordre lexicographique — deterministe,
    donc independant de l'ordre de lecture — et un conflit `merged_tracks`
    nomme toutes les fiches d'origine ;
  * charges differentes -> AUCUNE ligne, et un conflit `track_disagreement`
    qui porte les deux versions. La cle unique existante ne peut pas les
    distinguer, et deviner laquelle vaut serait inventer.

C'est la forme exacte de `absorb_any_regime()` et de la regle d'union F8 deja
en place : deux affirmations qui concordent en font une, deux affirmations qui
divergent remontent a l'admin. Aucune migration n'est necessaire, et la cle
`@@unique([programCampusId, study_year, regime])` n'est pas rouverte.

Ce que la fusion perd, et c'est dit : la distinction « 3e annee de la voie en
5 ans » / « 3e annee de la voie en 2 ou 3 ans » disparait la ou les deux voies
s'accordent. Elle ne disparait jamais la ou elles divergent — la, rien n'est
ecrit du tout.

## Ce qui n'est PAS de ce module

L'arete `ProgramCampus` elle-meme. Une ligne-annee dont l'arete n'existe pas en
base est deposee en conflit `edge_missing`, jamais creee : creer une arete
ouvre une option dans deux ecrans d'admin, une destination de capacite et une
tache Capacity facturee en Phase 2. Ce chemin passe par `validateProgramDiscovery`
et par la validation humaine, pas par ce module.
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Optional

from backend.pipeline.campus_attachment import fold_campus_name, fold_label

# Toute la plage des tirets Unicode, ramenee au tiret ASCII, pour les NOMS DE
# PROGRAMME. Les noms de campus passent par `fold_campus_name`, qui fait le meme
# repli.
_DASHES = re.compile(r"[‐-―−]")
# Apostrophes typographiques — « l'Innovation » des Masteres Specialises.
_APOSTROPHES = re.compile(r"[‘’ʼ]")
# La base ecrit « Master of Science (MSc) - X », le site « MSc X ».
_DEGREE_HEAD = re.compile(r"^master of science \(msc\)\s*-?\s*")
_NON_ALNUM = re.compile(r"[^0-9a-z]+")

# Mots de liaison, retires des deux cotes. `and` et `et` y figurent : voir la
# regle 2 de l'en-tete.
_LIAISON = frozenset({
    "en", "de", "du", "des", "d", "l", "le", "la", "les", "of", "in", "the",
    "and", "et", "a", "au", "aux", "ou", "or", "pour", "sur", "for", "to",
})

# Qualificatifs de MODALITE : ils disent COMMENT un diplome se suit, pas
# LEQUEL. Liste FERMEE, et volontairement etroite, pour la meme raison que les
# listes fermees de `campus_attachment` : un qualificatif qui manque coute un
# non-apparie, qui se voit ; un qualificatif de trop attache une fiche au
# mauvais diplome, ce qui ne se voit pas.
#
# Calibree sur les 6 fiches de ce corpus qui en portent :
#   « en 5 ans » · « en 2 ou 3 ans » · « en 3 ans » · « en 1 an »
#   « en blended learning » · « L'alternance du ... »
_MODALITY_TOKENS = frozenset({
    "1", "2", "3", "4", "5",
    "an", "ans", "annee", "annees", "year", "years",
    "alternance", "blended", "learning",
})

MATCH_EXACT = "A1"
MATCH_ACRONYM = "A2"
MATCH_VARIANT = "B"
MATCH_ABSENT = "ABSENT"
MATCH_AMBIGUOUS = "AMBIGU"


def canon_program_name(name: Optional[str]) -> tuple[str, ...]:
    """
    Forme canonique d'un nom de programme, en jetons.

    >>> canon_program_name("MSc Banking, Finance and FinTech")
    ('msc', 'banking', 'finance', 'fintech')
    >>> canon_program_name("Master of Science (MSc) - Banking, Finance and FinTech")
    ('msc', 'banking', 'finance', 'fintech')
    >>> canon_program_name("Bachelor en Management")
    ('bachelor', 'management')
    """
    if not name:
        return ()
    folded = _APOSTROPHES.sub("'", _DASHES.sub("-", fold_label(name)))
    folded = _DEGREE_HEAD.sub("msc ", folded)
    return tuple(
        token
        for token in _NON_ALNUM.sub(" ", folded).split()
        if token and token not in _LIAISON
    )


def _acronym(tokens: Iterable[str]) -> str:
    """Initiales des jetons — « international bachelor ... » donne « ibba »."""
    return "".join(token[0] for token in tokens if token)


def check_canonical_collisions(program_names: Iterable[str]) -> dict[str, list[str]]:
    """
    Couples de `Program` que la forme canonique fusionnerait, par cle.

    Le garde-fou de la regle 2 : si deux programmes REELS d'une meme ecole se
    replient sur la meme forme, la normalisation est trop agressive et
    l'appariement n'a plus de sens. Vide sur les 39 `Program` du corpus.
    """
    seen: dict[tuple[str, ...], list[str]] = {}
    for name in program_names:
        seen.setdefault(canon_program_name(name), []).append(name)
    return {
        " ".join(key): names
        for key, names in sorted(seen.items())
        if len(names) > 1
    }


def match_program(
    fiche_name: str,
    programs: list[dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    """
    `Program` que cette fiche designe, et par quelle clause.

    `programs` : des dicts portant au moins `id` et `name`.

    Rend `(clause, [programmes])`. La liste est vide si rien ne repond
    (`ABSENT`), a un element si l'appariement est certain (`A1`, `A2`, `B`), et
    a plusieurs si la clause est ambigue — auquel cas la clause est prefixee de
    `AMBIGU/` et RIEN ne doit etre ecrit. Preferer un non-apparie a un mauvais
    appariement est le sens de toute cette fonction.
    """
    fiche_tokens = canon_program_name(fiche_name)
    if not fiche_tokens:
        return MATCH_ABSENT, []
    fiche_set = set(fiche_tokens)

    def is_exact(db_tokens: tuple[str, ...]) -> bool:
        return db_tokens == fiche_tokens

    def is_acronym(db_tokens: tuple[str, ...]) -> bool:
        db_set = set(db_tokens)
        return bool(db_tokens) and db_set < fiche_set and fiche_set - db_set == {_acronym(db_tokens)}

    def is_variant(db_tokens: tuple[str, ...]) -> bool:
        db_set = set(db_tokens)
        return bool(db_tokens) and db_set < fiche_set and (fiche_set - db_set) <= _MODALITY_TOKENS

    for clause, predicate in (
        (MATCH_EXACT, is_exact),
        (MATCH_ACRONYM, is_acronym),
        (MATCH_VARIANT, is_variant),
    ):
        hits = [p for p in programs if predicate(canon_program_name(p.get("name")))]
        if len(hits) == 1:
            return clause, hits
        if len(hits) > 1:
            return f"{MATCH_AMBIGUOUS}/{clause}", hits

    return MATCH_ABSENT, []


def _payload_of(row: dict[str, Any]) -> tuple[Any, ...]:
    """Ce qu'une ligne-annee AFFIRME, `source_url` exclu."""
    return (tuple(row.get("languages") or []), row.get("note"))


def resolve_attachment_rows(
    fiches: list[dict[str, Any]],
    programs: list[dict[str, Any]],
    campuses: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Les lignes `ProgramCampusAttachment` reellement ecrivables, et le reste nomme.

    `programs`  : dicts `{id, name}`
    `campuses`  : dicts `{id, name}`
    `edges`     : dicts `{id, programId, campusId}` — les `ProgramCampus` existants

    Rien n'est cree : ni `Program`, ni `Campus`, ni `ProgramCampus`. Une ligne
    dont l'arete manque est deposee en conflit, jamais forcee.
    """
    by_campus_key = {fold_campus_name(c["name"]): c for c in campuses}
    by_edge = {(e["programId"], e["campusId"]): e for e in edges}
    programs_by_id = {p["id"]: p for p in programs}

    matches: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    # cle resolue -> lignes candidates, avec leur provenance
    grouped: dict[tuple[str, int, str], list[dict[str, Any]]] = {}

    for fiche in fiches:
        fiche_name = fiche.get("program") or ""
        clause, hits = match_program(fiche_name, programs)
        rows = fiche.get("program_campus_attachment") or []
        matches.append({
            "fiche": fiche_name,
            "clause": clause,
            "program_id": hits[0]["id"] if len(hits) == 1 else None,
            "program_name": hits[0]["name"] if len(hits) == 1 else None,
            "candidates": [h["name"] for h in hits] if len(hits) > 1 else [],
            "attachment_rows": len(rows),
        })

        if len(hits) != 1:
            for row in rows:
                conflicts.append({
                    "type": "program_unmatched",
                    "fiche": fiche_name,
                    "clause": clause,
                    "campus": row.get("campusName"),
                    "study_year": row.get("study_year"),
                    "regime": row.get("regime"),
                    "effect": "aucune ligne ecrite ; le programme n'est pas identifie en base",
                })
            continue

        program = hits[0]
        for row in rows:
            campus = by_campus_key.get(fold_campus_name(row.get("campusName")))
            if campus is None:
                conflicts.append({
                    "type": "campus_unmatched",
                    "fiche": fiche_name,
                    "program": program["name"],
                    "campus": row.get("campusName"),
                    "effect": "aucune ligne ecrite ; ce lieu n'est pas un campus de l'ecole en base",
                })
                continue
            edge = by_edge.get((program["id"], campus["id"]))
            if edge is None:
                conflicts.append({
                    "type": "edge_missing",
                    "fiche": fiche_name,
                    "program": program["name"],
                    "campus": campus["name"],
                    "study_year": row.get("study_year"),
                    "regime": row.get("regime"),
                    "effect": "aucune ligne ecrite ; l'arete ProgramCampus n'existe pas et"
                              " ce module n'en cree aucune",
                })
                continue
            key = (edge["id"], int(row.get("study_year") or 0), row.get("regime") or "ANY")
            grouped.setdefault(key, []).append({
                "fiche": fiche_name,
                "program": program["name"],
                "campus": campus["name"],
                "row": row,
            })

    writable: list[dict[str, Any]] = []
    for key, candidates in sorted(grouped.items(), key=lambda kv: (kv[1][0]["program"],
                                                                  kv[1][0]["campus"],
                                                                  kv[0][1], kv[0][2])):
        edge_id, study_year, regime = key
        payloads = {_payload_of(c["row"]) for c in candidates}
        first = candidates[0]

        if len(payloads) > 1:
            conflicts.append({
                "type": "track_disagreement",
                "program": first["program"],
                "campus": first["campus"],
                "study_year": study_year,
                "regime": regime,
                "fiches": sorted(c["fiche"] for c in candidates),
                "versions": [
                    {"fiche": c["fiche"],
                     "languages": c["row"].get("languages") or [],
                     "note": c["row"].get("note")}
                    for c in candidates
                ],
                "effect": "aucune ligne ecrite ; la cle unique ne peut pas porter"
                          " deux versions et rien ne dit laquelle vaut",
            })
            continue

        # Deterministe : la meme sortie quel que soit l'ordre de lecture.
        source_urls = sorted(
            {c["row"].get("source_url") for c in candidates if c["row"].get("source_url")}
        )
        writable.append({
            "programCampusId": edge_id,
            "program": first["program"],
            "campus": first["campus"],
            "study_year": study_year,
            "regime": regime,
            "languages": list(first["row"].get("languages") or []),
            "note": first["row"].get("note"),
            "source_url": source_urls[0] if source_urls else None,
            "_fiches": sorted(c["fiche"] for c in candidates),
        })
        if len(candidates) > 1:
            conflicts.append({
                "type": "merged_tracks",
                "program": first["program"],
                "campus": first["campus"],
                "study_year": study_year,
                "regime": regime,
                "fiches": sorted(c["fiche"] for c in candidates),
                "effect": "une seule ligne ecrite ; les fiches affirment la meme chose"
                          " et la cle unique n'a pas de place pour la voie d'acces",
            })

    from collections import Counter
    clause_counts = Counter(m["clause"] for m in matches)
    produced = sum(len(f.get("program_campus_attachment") or []) for f in fiches)

    return {
        "matches": matches,
        "writable_attachments": writable,
        "conflicts": conflicts,
        "canonical_collisions": check_canonical_collisions(p["name"] for p in programs),
        "totals": {
            "fiches": len(fiches),
            "programs_in_db": len(programs_by_id),
            "campuses_in_db": len(campuses),
            "edges_in_db": len(edges),
            "clauses": dict(sorted(clause_counts.items())),
            "attachment_rows_produced": produced,
            "attachment_rows_writable": len(writable),
            "attachment_rows_merged": sum(
                len(w["_fiches"]) - 1 for w in writable if len(w["_fiches"]) > 1
            ),
            "conflicts": dict(sorted(Counter(c["type"] for c in conflicts).items())),
        },
    }
