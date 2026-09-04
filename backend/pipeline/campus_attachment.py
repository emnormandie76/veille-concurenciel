"""
backend/pipeline/campus_attachment.py — Des enonces de lieu aux lignes des trois tables

Ce module ne parle a personne : ni reseau, ni base, ni Gemini. Il prend la
sortie du schema `Campus_Attachment` et la liste des campus REELS d'une ecole,
et il rend les lignes que l'on ecrirait dans `ProgramCampus`,
`ProgramCampusAttachment` et `ProgramPlacement`.

Il n'est branche nulle part. `backend/scripts/simulate_campus_attachment.py`
est son seul appelant, et il ecrit des fichiers JSON.

## Les trois regles que ce fichier applique

**1. F8 — de l'encart ou de la section, qui fait foi ?**

Les deux fiches PGE d'EM Normandie se contredisent dans les deux sens :
Le Havre est dans l'encart et absent de la section, Dubai est dans la section
et absent de l'encart. Aucune des deux zones n'est un resume de l'autre — le
champ etiquete sous-declare autant qu'il sur-declare.

La regle retenue ne choisit pas une zone contre l'autre, elle leur donne des
portees differentes :

  * `ProgramCampus` = UNION de toutes les zones. L'arete signifie « ce
    programme est ouvert sur ce campus » ; l'encart est une affirmation
    legitime de cela, la section aussi. Les deux affirmations sont gardees.
  * `ProgramCampusAttachment` = SECTION SEULE. Une ligne fille porte
    `study_year`, et l'encart ne parle jamais d'annee. En faire naitre une
    ligne-annee reviendrait a inventer l'annee.

Consequence sur les deux fiches PGE, et c'est le test :
  - Le Havre (encart, absent de la section) → une ligne `ProgramCampus`, ZERO
    ligne fille, et une entree dans `conflicts` de type `field_only`.
  - Dubai (section, absent de l'encart) → une ligne `ProgramCampus` ET ses
    lignes filles, plus une entree `section_only`.

La seconde affirmation atterrit donc sur l'arete et dans le bloc `conflicts`
de la sortie seche. Elle n'atterrit dans AUCUNE ligne-annee, par construction :
c'est le prix de la regle, et il est dit.

**2. `regime = "ANY"` face a `INITIAL` / `ALTERNANCE`.**

`@@unique([programCampusId, study_year, regime])` laisse coexister
`(pc, 1, ANY)` et `(pc, 1, INITIAL)`, qui se contredisent : le premier dit
« cette annee, tous regimes », le second nomme un regime et, par son existence,
suggere que l'autre a sa propre liste.

Interdit A L'ECRITURE, pas dans le schema. Pour un couple
(programCampusId, study_year) donne, l'axe regime est soit entierement ANY,
soit entierement specifique. Si les deux apparaissent, la ligne ANY est
ABSORBEE : elle disparait et ses langues sont versees dans chaque ligne
specifique. La ligne specifique est strictement plus informative ; garder ANY
a cote reviendrait a affirmer un regime que la fiche ne propose pas.

Pourquoi pas une contrainte en base. Le seul enonce SQL qui exprime vraiment
l'invariant est une contrainte d'exclusion :

    EXCLUDE USING gist (
        "programCampusId" WITH =, "study_year" WITH =, (regime = 'ANY') WITH <>
    )

Elle exige l'extension `btree_gist`, et Prisma ne sait pas la declarer : elle
reapparaitrait en derive de schema a chaque `migrate diff`. L'etude a deja
refuse exactement ce compromis pour `study_year` nullable, ou une sentinelle a
ete preferee a un index unique nullable justement pour que la contrainte reste
exprimable en Prisma. Un CHECK ne porte que sur une ligne ; un index unique
partiel n'exprime pas « ANY exclut les autres ». Aucune migration
supplementaire n'est donc ecrite, et l'invariant est tenu par
`absorb_any_regime()` — une seule porte, testee.

**3. La normalisation de `label`.**

`label` est du texte libre et il entre dans
`@@unique([programId, study_year, regime, label])`. « Universite partenaire »
et « Université partenaire » y feraient deux lignes, et ce depot ecrit sans
accents a plusieurs endroits — la migration commitee elle-meme.

Regle : **on deduplique sur une cle repliee, on stocke l'orthographe publiee.**

  * `fold_label()` : NFD, suppression des diacritiques, casefold, ponctuation
    de bord retiree, espaces internes replies. C'est la CLE, elle n'est jamais
    stockee.
  * `pick_spelling()` : parmi les orthographes vues pour une meme cle, on garde
    la plus accentuee, puis la plus longue, puis la premiere par ordre
    lexicographique. Deterministe, donc independante de l'ordre de lecture.

La meme cle sert a decider si un libelle designe un campus du parc — c'est ce
qui donne `kind` sans la base, a partir de la liste passee en parametre.

Risque nomme : replier les accents fusionne deux libelles qui ne differeraient
que par un accent et designeraient deux lieux distincts. Aucun cas de ce genre
sur les libelles rencontres (voir le rapport) ; la regle est un pari, pas un
theoreme.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

# Zones telles que le schema les declare. FIELD et INDEX_CARD portent la meme
# affirmation — l'encart a champs nommes — publiee a deux endroits.
FIELD_ZONES = frozenset({"FIELD", "INDEX_CARD"})
SECTION_ZONE = "SECTION"
PROSE_ZONE = "PROSE"

VALID_ZONES = frozenset({"FIELD", "INDEX_CARD", "SECTION", "PROSE"})
VALID_REGIMES = frozenset({"ANY", "INITIAL", "ALTERNANCE"})

# `kind` de ProgramPlacement, tel que le commentaire du schema Prisma le decrit.
KIND_PARTNER = "PARTNER"
KIND_REGION = "REGION"
KIND_REMOTE = "REMOTE"
KIND_UNSPECIFIED = "UNSPECIFIED"

_WHITESPACE = re.compile(r"\s+")
# Ponctuation de bord seulement : « Lyon, » et « Lyon » sont le meme lieu, mais
# « Quebec (Region) » garde ses parentheses internes, qui portent du sens.
_EDGE_PUNCT = re.compile(r"^[\s\-–—,;:.·•*]+|[\s\-–—,;:.·•*]+$")

# Marqueurs d'enseignement a distance. Cherches en sous-chaine : « Blended
# learning E-learning » est une valeur reellement publiee par EM Normandie.
_REMOTE_MARKERS = (
    "online", "e-learning", "elearning", "distanciel", "a distance",
    "distance learning", "blended learning", "hybride", "en ligne",
)

# Zones et pays observes dans le champ campus d'Em Lyon. Liste FERMEE : une
# liste ouverte de toponymes ferait passer pour une region toute ville
# inconnue, ce qui est exactement l'erreur a ne pas commettre.
_REGION_LABELS = frozenset({
    "international", "europe", "monde", "worldwide", "global",
    "asie", "afrique", "amerique du nord", "amerique du sud", "moyen-orient",
    "finlande", "vietnam", "afrique du sud", "chypre", "quebec",
    "canada", "chine", "japon", "coree du sud", "inde", "bresil",
    "etats-unis", "royaume-uni", "allemagne", "espagne", "italie",
})
_REGION_PATTERN = re.compile(r"\((region|regione|region\b)\)", re.IGNORECASE)

# Mots qui designent un etablissement, donc un partenaire quand le libelle
# n'est pas un campus du parc.
_INSTITUTION_MARKERS = (
    "universite", "university", "universita", "universidad",
    "ecole", "school", "institut", "institute", "college",
    "polytech", "hec", "centrale", "partenaire", "partner",
)

# Conjonctions qui trahissent une expression non resolue (F14). Un libelle qui
# en porte n'est pas un lieu : c'est une phrase rangee telle quelle.
_COMPOUND_MARKERS = (" ou ", " et ", " and ", " or ", " + ", "/")


# ── Reduction d'affixes, pour la RECONNAISSANCE seulement ────────
#
# Mesure du 4 septembre sur les deux ecoles : la premiere cause d'erreur n'est
# ni l'accent ni la casse, c'est le qualificatif colle au lieu. Les fiches
# ecrivent « campus de Shanghai », « Lyon, France », « Lyon, avec une
# experience internationale » la ou l'encart ecrit « Shanghai » et « Lyon ».
# Replies tels quels, ces libelles ne reconnaissent pas le campus du parc : ils
# tombent en ProgramPlacement, ou ils dupliquent une arete qui existe deja.
#
# Ces motifs ne servent QU'A RECONNAITRE un campus fourni en parametre. Ils ne
# touchent ni au libelle stocke, ni a la cle d'unicite de ProgramPlacement :
# reduire ce qui est stocke reviendrait a reecrire ce que la fiche publie, et
# la colonne `label` existe justement pour le garder intact.
_CAMPUS_PREFIXES = (
    "le campus de ", "le campus du ", "le campus d'", "le campus ",
    "campus de ", "campus du ", "campus des ", "campus d'", "campus ",
    "site de ", "site du ",
)

# Ce qui suit une virgule ou « avec » est un complement, pas le lieu.
_TRAILING_CLAUSE = re.compile(r"\s*(,|\bavec\b|\bwith\b)\s.*$", re.IGNORECASE)


def fold_label(label: Optional[str]) -> str:
    """
    Cle de deduplication d'un libelle de lieu.

    Sans accents, sans casse, sans ponctuation de bord, espaces replies. Cette
    valeur n'est JAMAIS stockee : elle sert a reconnaitre que deux orthographes
    designent le meme lieu.

    >>> fold_label("Université  partenaire ")
    'universite partenaire'
    >>> fold_label("Universite partenaire") == fold_label("Université partenaire")
    True
    """
    if not label:
        return ""
    decomposed = unicodedata.normalize("NFD", label)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    stripped = _WHITESPACE.sub(" ", stripped)
    stripped = _EDGE_PUNCT.sub("", stripped)
    return stripped.casefold()


def _accent_count(text: str) -> int:
    """Nombre de diacritiques d'une chaine — sert a departager deux orthographes."""
    return sum(1 for ch in unicodedata.normalize("NFD", text) if unicodedata.combining(ch))


def pick_spelling(spellings: Iterable[str]) -> str:
    """
    Orthographe retenue parmi celles vues pour une meme cle repliee.

    Ordre : la plus accentuee d'abord — « Université partenaire » porte une
    information que « Universite partenaire » a perdue — puis la plus longue,
    puis la premiere par ordre lexicographique. Le resultat ne depend pas de
    l'ordre de lecture des pages.
    """
    candidates = [s.strip() for s in spellings if s and s.strip()]
    if not candidates:
        return ""
    return sorted(candidates, key=lambda s: (-_accent_count(s), -len(s), s))[0]


def normalize_languages(values: Optional[Iterable[str]]) -> list[str]:
    """Langues en codes courts majuscules, dedoublonnees et triees."""
    seen = {v.strip().upper() for v in (values or []) if isinstance(v, str) and v.strip()}
    return sorted(seen)


def classify_kind(label: str, campus_folds: frozenset[str]) -> str:
    """
    `kind` d'un lieu qui n'est PAS un campus du parc.

    L'etude le disait franchement : cette table « offre un tiroir, pas un
    critere ». Ce classement est une heuristique, et le rapport en donne le
    taux d'erreur mesure. L'ordre des tests compte :

      1. a distance ;
      2. zone ou pays, sur une liste FERMEE ;
      3. etablissement nomme (universite, ecole, institut...) ;
      4. expression non resolue (« Paris et New York ou Londres ») → tiroir ;
      5. toponyme nu inconnu du parc → partenaire, parce qu'un programme qui
         nomme un lieu qui n'est pas a lui y envoie ses etudiants ;
      6. le reste → tiroir.
    """
    folded = fold_label(label)
    if not folded:
        return KIND_UNSPECIFIED

    if any(marker in folded for marker in _REMOTE_MARKERS):
        return KIND_REMOTE

    if folded in _REGION_LABELS or _REGION_PATTERN.search(label or ""):
        return KIND_REGION
    # « Quebec (Region) » : la parenthese est le marqueur, mais le noyau peut
    # aussi suffire.
    core = _EDGE_PUNCT.sub("", folded.split("(")[0])
    if core in _REGION_LABELS:
        return KIND_REGION

    if any(marker in folded for marker in _INSTITUTION_MARKERS):
        return KIND_PARTNER

    if any(marker in folded for marker in _COMPOUND_MARKERS):
        return KIND_UNSPECIFIED

    # Un toponyme nu, court, qui n'est pas un campus de l'ecole.
    if folded not in campus_folds and len(folded.split()) <= 4:
        return KIND_PARTNER

    return KIND_UNSPECIFIED


def match_campus(label: Optional[str], campus_folds: dict[str, str]) -> Optional[str]:
    """
    Nom du campus du parc que ce libelle designe, ou None.

    Deux passes, dans cet ordre :

      1. la cle repliee telle quelle — « DUBAI » reconnait « Dubai » ;
      2. la meme cle une fois le qualificatif ote — « campus de Shanghai » et
         « Lyon, avec une experience internationale » reconnaissent « Shanghai »
         et « Lyon ».

    La seconde passe ne s'applique qu'a la reconnaissance. Ce qui est stocke
    reste le libelle publie.

    Limite nommee, non traitee : la forme adjectivale. « campus parisien »
    designe Paris et aucune reduction d'affixe ne le dira — il faudrait un
    dictionnaire de gentiles. Ce libelle finit donc en ProgramPlacement, et le
    rapport le compte comme une erreur.
    """
    folded = fold_label(label)
    if not folded:
        return None
    if folded in campus_folds:
        return campus_folds[folded]

    reduced = folded
    for prefix in _CAMPUS_PREFIXES:
        if reduced.startswith(prefix):
            reduced = reduced[len(prefix):].strip()
            break
    reduced = fold_label(_TRAILING_CLAUSE.sub("", reduced))
    if reduced and reduced in campus_folds:
        return campus_folds[reduced]
    return None


@dataclass
class Statement:
    """Un enonce de lieu, normalise et rattache a sa zone."""

    program_name: str
    zone: str
    study_year: int
    regime: str
    label: Optional[str]
    languages: list[str] = field(default_factory=list)
    verbatim: Optional[str] = None
    source_url: Optional[str] = None

    @property
    def fold(self) -> str:
        return fold_label(self.label)


def parse_statements(raw: Any) -> tuple[list[Statement], list[dict]]:
    """
    Valide la sortie du modele. Rend (enonces retenus, enonces rejetes).

    Un enonce mal forme est ECARTE et compte, jamais repare en silence : c'est
    ce comptage qui donne le taux d'erreur du rapport.
    """
    kept: list[Statement] = []
    rejected: list[dict] = []

    items = raw.get("statements") if isinstance(raw, dict) else None
    for item in items or []:
        if not isinstance(item, dict):
            rejected.append({"reason": "not_an_object", "raw": repr(item)[:200]})
            continue

        name = (item.get("program_name") or "").strip()
        zone = (item.get("zone") or "").strip().upper()
        regime = (item.get("regime") or "ANY").strip().upper()
        year = item.get("study_year")

        if not name:
            rejected.append({"reason": "missing_program_name", "raw": item})
            continue
        if zone not in VALID_ZONES:
            rejected.append({"reason": f"unknown_zone:{zone}", "raw": item})
            continue
        if regime not in VALID_REGIMES:
            rejected.append({"reason": f"unknown_regime:{regime}", "raw": item})
            continue
        if not isinstance(year, int) or isinstance(year, bool) or year < 0:
            rejected.append({"reason": "bad_study_year", "raw": item})
            continue
        # L'encart ne parle pas d'annee : une annee > 0 en zone FIELD est une
        # invention du modele, pas une lecture.
        if zone in FIELD_ZONES and year != 0:
            rejected.append({"reason": "year_on_field_zone", "raw": item})
            continue
        # Un lieu inconnu sans annee ne dit rien : ni ou, ni quand.
        label = item.get("label")
        if label is not None and not str(label).strip():
            label = None
        if label is None and year == 0:
            rejected.append({"reason": "null_label_without_year", "raw": item})
            continue

        kept.append(
            Statement(
                program_name=name,
                zone=zone,
                study_year=year,
                regime=regime,
                label=str(label).strip() if label is not None else None,
                languages=normalize_languages(item.get("languages")),
                verbatim=(item.get("verbatim") or None),
                source_url=(item.get("source_url") or None),
            )
        )

    return kept, rejected


def absorb_any_regime(rows: list[dict], key_fields: tuple[str, ...]) -> list[dict]:
    """
    Applique la regle 2 : pour une meme cle, ANY et un regime nomme ne
    coexistent pas.

    La ligne ANY disparait et ses langues sont versees dans chaque ligne
    specifique. Les lignes absorbees sont signalees par la cle interne
    `_absorbed_any`, que l'appelant remonte en diagnostic.

    `key_fields` designe ce qui identifie une ligne HORS regime :
    ("programCampusId", "study_year") pour les attachments,
    ("programId", "study_year", "label_fold") pour les placements.
    """
    buckets: dict[tuple, list[dict]] = {}
    for row in rows:
        buckets.setdefault(tuple(row[f] for f in key_fields), []).append(row)

    kept: list[dict] = []
    for _, group in buckets.items():
        any_rows = [r for r in group if r["regime"] == "ANY"]
        specific = [r for r in group if r["regime"] != "ANY"]
        if any_rows and specific:
            merged = normalize_languages(
                lang for r in any_rows for lang in r.get("languages", [])
            )
            for row in specific:
                row["languages"] = normalize_languages(row.get("languages", []) + merged)
                row["_absorbed_any"] = True
            kept.extend(specific)
        else:
            kept.extend(group)
    return kept


def _merge_languages(rows: Iterable[dict]) -> list[str]:
    return normalize_languages(lang for r in rows for lang in r.get("languages", []))


def build_program_rows(
    program_name: str,
    statements: list[Statement],
    campus_folds: dict[str, str],
    policy_note: Optional[str] = None,
) -> dict:
    """
    Lignes des trois tables pour UN programme.

    `campus_folds` : cle repliee -> nom du campus tel que l'ecole l'ecrit. C'est
    la liste des campus REELS, passee en parametre explicite. Demain elle
    viendra de la table `Campus` ; aujourd'hui c'est ce qui debloque `kind`
    sans la base.
    """
    section = [s for s in statements if s.zone == SECTION_ZONE]
    fieldish = [s for s in statements if s.zone in FIELD_ZONES]
    prose = [s for s in statements if s.zone == PROSE_ZONE]
    has_section = bool(section)

    conflicts: list[dict] = []

    # ── ProgramCampus : union de toutes les zones (regle 1) ──────────
    campus_seen: dict[str, dict] = {}
    placement_statements: list[Statement] = []

    for stmt in statements:
        if stmt.label is None:
            # F9 : l'annee est nommee, la page dit qu'aucun lieu n'est fixe.
            # Aucune ligne — mais le fait est trace, sinon « annee vide » et
            # « annee non collectee » deviennent indiscernables.
            conflicts.append({
                "type": "year_without_place",
                "program": program_name,
                "study_year": stmt.study_year,
                "regime": stmt.regime,
                "verbatim": stmt.verbatim,
                "source_url": stmt.source_url,
            })
            continue
        matched = match_campus(stmt.label, campus_folds)
        if matched is not None:
            entry = campus_seen.setdefault(
                fold_label(matched), {"zones": set(), "spellings": [], "source_url": None}
            )
            entry["zones"].add(stmt.zone)
            entry["spellings"].append(stmt.label)
            entry["source_url"] = entry["source_url"] or stmt.source_url
        else:
            placement_statements.append(stmt)

    program_campus = [
        {
            "programName": program_name,
            "campusName": campus_folds[fold],
            "_zones": sorted(entry["zones"]),
        }
        for fold, entry in sorted(campus_seen.items(), key=lambda kv: campus_folds[kv[0]])
    ]

    # ── F8 : desaccords entre l'encart et la section ─────────────────
    if has_section:
        section_folds = {
            fold_label(match_campus(s.label, campus_folds))
            for s in section
            if match_campus(s.label, campus_folds)
        }
        field_folds = {
            fold_label(match_campus(s.label, campus_folds))
            for s in fieldish
            if match_campus(s.label, campus_folds)
        }
        for fold in sorted(field_folds - section_folds):
            if fold not in campus_folds:
                continue
            conflicts.append({
                "type": "field_only",
                "program": program_name,
                "campus": campus_folds[fold],
                "effect": "ligne ProgramCampus conservee, aucune ligne fille",
            })
        for fold in sorted(section_folds - field_folds):
            if fold not in campus_folds:
                continue
            conflicts.append({
                "type": "section_only",
                "program": program_name,
                "campus": campus_folds[fold],
                "effect": "ligne ProgramCampus creee, lignes filles ecrites",
            })

    # ── ProgramCampusAttachment : la SECTION seule (regle 1) ─────────
    attachment_rows: list[dict] = []
    grouped: dict[tuple[str, int, str], list[Statement]] = {}
    for stmt in section:
        matched = match_campus(stmt.label, campus_folds)
        if matched is None:
            continue
        grouped.setdefault(
            (fold_label(matched), stmt.study_year, stmt.regime), []
        ).append(stmt)

    for (fold, year, regime), group in grouped.items():
        attachment_rows.append({
            "programName": program_name,
            "campusName": campus_folds[fold],
            "programCampusId": f"{program_name}||{campus_folds[fold]}",
            "study_year": year,
            "regime": regime,
            "languages": normalize_languages(
                lang for s in group for lang in s.languages
            ),
            "note": None,
            "source_url": next((s.source_url for s in group if s.source_url), None),
        })

    attachment_rows = absorb_any_regime(
        attachment_rows, key_fields=("programCampusId", "study_year")
    )
    for row in attachment_rows:
        if row.pop("_absorbed_any", False):
            conflicts.append({
                "type": "regime_absorbed",
                "program": program_name,
                "campus": row["campusName"],
                "study_year": row["study_year"],
                "kept_regime": row["regime"],
                "effect": "ligne ANY supprimee, ses langues versees dans la ligne nommee",
            })

    attachment_rows.sort(
        key=lambda r: (r["campusName"], r["study_year"], r["regime"])
    )

    # ── ProgramPlacement : tout ce qui n'est pas un campus du parc ───
    placement_groups: dict[tuple[int, str, str], list[Statement]] = {}
    for stmt in placement_statements:
        placement_groups.setdefault(
            (stmt.study_year, stmt.regime, stmt.fold), []
        ).append(stmt)

    placement_rows: list[dict] = []
    for (year, regime, fold), group in placement_groups.items():
        label = pick_spelling(s.label for s in group if s.label)
        placement_rows.append({
            "programName": program_name,
            "study_year": year,
            "regime": regime,
            "label": label,
            "label_fold": fold,
            "kind": classify_kind(label, frozenset(campus_folds)),
            "languages": normalize_languages(
                lang for s in group for lang in s.languages
            ),
            "note": next((s.verbatim for s in group if s.verbatim), None),
            "source_url": next((s.source_url for s in group if s.source_url), None),
        })

    placement_rows = absorb_any_regime(
        placement_rows, key_fields=("programName", "study_year", "label_fold")
    )
    for row in placement_rows:
        if row.pop("_absorbed_any", False):
            conflicts.append({
                "type": "regime_absorbed",
                "program": program_name,
                "label": row["label"],
                "study_year": row["study_year"],
                "kept_regime": row["regime"],
                "effect": "ligne ANY supprimee, ses langues versees dans la ligne nommee",
            })

    # Les orthographes repliees sur une meme cle : ce que la regle 3 a fusionne.
    spelling_merges = []
    by_fold: dict[str, set[str]] = {}
    for stmt in statements:
        if stmt.label:
            by_fold.setdefault(stmt.fold, set()).add(stmt.label)
    for fold, spellings in sorted(by_fold.items()):
        if len(spellings) > 1:
            spelling_merges.append({
                "fold": fold,
                "seen": sorted(spellings),
                "kept": pick_spelling(spellings),
            })

    placement_rows.sort(key=lambda r: (r["label"], r["study_year"], r["regime"]))
    for row in placement_rows:
        row.pop("label_fold", None)

    return {
        "program": program_name,
        "campus_policy_note": policy_note,
        "has_section": has_section,
        "has_prose_only": bool(prose) and not has_section and not fieldish,
        "program_campus": program_campus,
        "program_campus_attachment": attachment_rows,
        "program_placement": placement_rows,
        "conflicts": conflicts,
        "spelling_merges": spelling_merges,
    }


def build_rows(
    raw: Any,
    campuses: list[str],
) -> dict:
    """
    Sortie complete pour une ecole : les lignes des trois tables, programme par
    programme, plus ce qui a ete rejete et ce qui se contredit.

    `campuses` est la liste des campus REELS de l'ecole, passee explicitement.
    """
    campus_folds: dict[str, str] = {}
    for name in campuses:
        folded = fold_label(name)
        if folded:
            campus_folds.setdefault(folded, name.strip())

    statements, rejected = parse_statements(raw)

    policies: dict[str, str] = {}
    for item in (raw.get("policies") if isinstance(raw, dict) else None) or []:
        if isinstance(item, dict) and item.get("program_name") and item.get("policy_note"):
            policies[item["program_name"].strip()] = item["policy_note"].strip()

    by_program: dict[str, list[Statement]] = {}
    for stmt in statements:
        by_program.setdefault(stmt.program_name, []).append(stmt)

    programs = [
        build_program_rows(name, group, campus_folds, policies.get(name))
        for name, group in sorted(by_program.items())
    ]
    # Une contrainte en prose sur un programme dont aucun lieu n'a ete lu doit
    # rester visible : sinon la phrase disparait avec le programme.
    for name, note in sorted(policies.items()):
        if name not in by_program:
            programs.append(
                build_program_rows(name, [], campus_folds, note)
            )

    return {
        "campuses_supplied": [campus_folds[f] for f in sorted(campus_folds)],
        "programs": programs,
        "rejected_statements": rejected,
        "totals": {
            "programs": len(programs),
            "statements_kept": len(statements),
            "statements_rejected": len(rejected),
            "program_campus": sum(len(p["program_campus"]) for p in programs),
            "program_campus_attachment": sum(
                len(p["program_campus_attachment"]) for p in programs
            ),
            "program_placement": sum(len(p["program_placement"]) for p in programs),
            "conflicts": sum(len(p["conflicts"]) for p in programs),
        },
    }
