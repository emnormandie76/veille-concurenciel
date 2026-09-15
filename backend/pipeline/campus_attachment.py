"""
backend/pipeline/campus_attachment.py — Des enonces de lieu aux lignes des trois tables

Ce module ne parle a personne : ni reseau, ni base, ni Gemini. Il prend la
sortie du schema `Campus_Attachment`, la liste des campus REELS d'une ecole, et
le markdown des pages deja lues, et il rend les lignes que l'on ecrirait dans
`ProgramCampus`, `ProgramCampusAttachment` et `ProgramPlacement`.

Il ne fait aucun appel lui-meme. `backend/pipeline/campus_attachment_collector.py`
l'enchaine a la lecture des pages, pour la sortie seche
(`backend/scripts/simulate_campus_attachment.py`) comme pour la Phase 1.

## La liste des campus vient de la table `Campus`

`build_rows()` recoit les noms tels que la base les ecrit, et c'est ce qui
oblige a replier la cle d'un campus plus fort que celle d'un libelle :
`fold_campus_name()` ramene les tirets Unicode au tiret ASCII et retire le mot
« campus » aux deux bords. Sans elle, « Campus Saint‑Etienne » (U+2011) et
« Lyon campus » ne reconnaitraient jamais « Saint-Etienne » ni « Lyon ». Deux
noms de la base qui se replient sur la meme cle ne reconnaissent plus rien :
ils sont rendus dans `campus_key_collisions`, jamais fusionnes en silence.

## Trois regles, puis deux gardes

Les trois regles ci-dessous decident de la FORME des lignes. Les deux gardes
de `apply_page_guards` decident de leur EXISTENCE, en confrontant ce que le
modele affirme a ce que la page porte — le modele propose, la page dispose.
Elles ne peuvent qu'ecarter, jamais completer : ce qu'elles laissent passer
est plus sur, ce qu'elles retirent devient une ligne manquante, qui se voit,
et non une ligne fausse, qui ne se voit pas. Mesure du 4 septembre sur les
deux ecoles : 148 lignes dont 35 en defaut avant, 121 dont 10 apres, et les
lignes fausses passent de 26 a 4.

Elles ne s'appliquent que si `pages` est fourni a `build_rows` : sans pages,
la sortie est celle d'avant les gardes, ce qui rend leur effet mesurable et
pas seulement annonce.

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
INDEX_CARD_ZONE = "INDEX_CARD"
SECTION_ZONE = "SECTION"
PROSE_ZONE = "PROSE"

# Zone INTERNE, jamais produite par le modele : une section dont la page ne
# publie pas l'annee. Elle vaut affirmation de lieu (elle entre dans l'union
# ProgramCampus) et pas affirmation d'annee (elle n'entre pas dans les lignes
# filles). Voir `apply_page_guards`, garde 2.
SECTION_UNDATED_ZONE = "SECTION_UNDATED"

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

# Toute la plage des tirets Unicode, plus le signe moins, ramenee au tiret
# ASCII. U+2011 (trait d'union insecable) est le cas reel : la base ecrit
# « Campus Saint‑Etienne » avec lui, et NFD ne le touche pas — ce n'est pas un
# diacritique, aucun repli d'accents ne le rattrape.
_DASHES = re.compile(r"[‐-―−]")
# Le mot « campus » quand il fait partie du NOM du campus, aux deux bords :
# Em Lyon ecrit en base « Campus Bhubaneswar » comme « Lyon campus ».
_CAMPUS_WORD = re.compile(r"^campus\s+|\s+campus$")

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


def fold_campus_name(name: Optional[str]) -> str:
    """
    Cle d'un nom de campus, applicable des DEUX cotes : le nom que la table
    `Campus` porte et le libelle que la fiche publie.

    `fold_label()` plus deux replis mesures sur la base reelle : les tirets
    Unicode ramenes au tiret ASCII, et le mot « campus » retire aux deux bords.
    « Le Havre » reste un seul lieu : seul un « campus » de bord est retire.

    >>> fold_campus_name("Lyon campus")
    'lyon'
    >>> fold_campus_name("Campus Bhubaneswar")
    'bhubaneswar'
    >>> fold_campus_name("Campus Saint‑Étienne") == fold_campus_name("Saint-Etienne")
    True
    """
    if not name:
        return ""
    return _CAMPUS_WORD.sub("", _DASHES.sub("-", fold_label(name))).strip()


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

    `campus_folds` est cle par `fold_campus_name()`, et le libelle l'est de
    meme : c'est ce qui fait reconnaitre « Lyon » par « Lyon campus ».

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
    key = fold_campus_name(label)
    if key in campus_folds:
        return campus_folds[key]

    # La reduction d'affixes lit le libelle replie ordinaire : « campus de »
    # est un prefixe a oter entier, pas un mot « campus » de bord.
    reduced = folded
    for prefix in _CAMPUS_PREFIXES:
        if reduced.startswith(prefix):
            reduced = reduced[len(prefix):].strip()
            break
    reduced = fold_campus_name(_TRAILING_CLAUSE.sub("", reduced))
    if reduced and reduced in campus_folds:
        return campus_folds[reduced]
    return None


# ── Ce que la PAGE dit — verifie en Python, jamais affirme par le modele ──
#
# Les deux gardes de ce bloc partagent une meme forme : le modele propose, la
# page dispose. Elles ne lisent que le markdown deja lu par le collecteur, ne
# font aucun appel, et ne peuvent qu'ECARTER — jamais completer. Le sens de
# l'erreur qui subsiste est donc « ligne manquante », pas « ligne fausse ».

# Un lien markdown : [texte d'ancrage](href "titre optionnel"). Le texte
# d'ancrage n'est PAS un mot : sur les pages d'index d'EM Normandie, une carte
# entiere — titre, « Campus », valeur, « Rythme » — tient dans l'ancrage d'un
# seul lien. C'est ce qui rend la garde 1 possible : la carte a des bords.
_MD_LINK = re.compile(
    r"""\[([^\[\]]*)\]\(\s*(<[^>]*>|[^()\s]+)\s*(?:"[^"]*"|'[^']*')?\s*\)""",
    re.S,
)
_MD_DECOR = re.compile(r"[*_`~#]+")
_ASSET_SUFFIX = re.compile(
    r"\.(?:pdf|jpe?g|png|gif|svg|webp|avif|ico|zip|docx?|xlsx?|pptx?|mp[34]|css|js)$",
    re.IGNORECASE,
)
_UNUSABLE_SCHEME = ("#", "mailto:", "tel:", "javascript:", "data:")

# Marqueurs d'annee. Liste fermee, et volontairement etroite : un marqueur qui
# manque coute une ligne fille en moins, un marqueur de trop rouvre exactement
# le defaut qu'on ferme.
_YEAR_RANGE = re.compile(
    r"\b([1-9])\s*(?:res?|eres?|ers?|es?|emes?|nde?s?)?\s*(?:et|ou|a|,|/|-)\s*"
    r"([1-9])\s*(?:res?|eres?|ers?|es?|emes?|nde?s?)?\s*ann"
)
_YEAR_ORDINAL = re.compile(r"\b([1-9])\s*(?:res?|eres?|ers?|es?|emes?|nde?s?)\b[\s\-]*ann")
_YEAR_LABELLED = re.compile(r"\bann[e]?es?\s*(?:n[o°]?\s*)?([1-9])\b")
_YEAR_EN_PREFIX = re.compile(r"\byear\s*([1-9])\b")
_YEAR_EN_SUFFIX = re.compile(r"\b([1-9])(?:st|nd|rd|th)\s+year\b")
_YEAR_WORDS = {
    "premiere": 1, "deuxieme": 2, "troisieme": 3, "quatrieme": 4, "cinquieme": 5,
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5,
}
_YEAR_WORD_PATTERNS = tuple(
    (re.compile(r"\b" + word + r"\s+(?:ann|year)"), value)
    for word, value in _YEAR_WORDS.items()
)

# Titres de section qui declarent un RATTACHEMENT, par opposition a un titre
# qui decrit le CONTENU d'une annee (« Annee 1 : Pre-MSc »). Liste FERMEE, pour
# la meme raison que _REGION_LABELS : une liste ouverte finirait par accepter
# n'importe quel titre portant le mot campus.
_ATTACHMENT_HEADING_MARKERS = (
    "rattachement", "affectation", "assignment", "allocation",
)
_ATTACHMENT_HEADING_SUBJECT = ("campus", "site", "lieu", "location")
_HEADING_LINE = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$", re.MULTILINE)
# Le fil d'Ariane rendu par Tavily : « 2. Nom de la page », sans lien pour
# l'element courant. C'est souvent la seule occurrence du titre exact.
_BREADCRUMB_LINE = re.compile(r"^\s{0,3}\d+\.\s+(?!\[)(.+?)\s*$", re.MULTILINE)


def _fold_plain(text: Optional[str]) -> str:
    """Comme `fold_label`, mais en otant d'abord la decoration markdown."""
    return fold_label(_MD_DECOR.sub(" ", text or ""))


def _href_is_usable(href: str) -> bool:
    """
    Vrai si ce href peut mener a une fiche.

    Ecarte l'ancre interne, le mailto, l'asset — et surtout la QUERY STRING :
    les quatre rubriques thematiques d'Em Lyon pointent vers une facette
    `/fr/programmes?title=&domain%5B6%5D=6...`, qui est une recherche, pas une
    fiche.
    """
    href = (href or "").strip().strip("<>")
    if not href or href.lower().startswith(_UNUSABLE_SCHEME):
        return False
    if "?" in href or "#" in href.split("/")[-1]:
        return False
    path = href.split("?")[0].rstrip("/")
    if _ASSET_SUFFIX.search(path):
        return False
    return bool(path)


def published_years(text: str) -> frozenset[int]:
    """
    Annees d'etudes que ce texte de page NOMME explicitement.

    « 4e et 5e annees » en rend deux ; « Annee 1 : Pre-MSc » en rend une ;
    « Duree 12 mois » n'en rend aucune, et c'est tout l'objet de la garde 2.
    """
    folded = _fold_plain(text)
    years: set[int] = set()
    for first, second in _YEAR_RANGE.findall(folded):
        years.update({int(first), int(second)})
    for pattern in (_YEAR_ORDINAL, _YEAR_LABELLED, _YEAR_EN_PREFIX, _YEAR_EN_SUFFIX):
        years.update(int(m) for m in pattern.findall(folded))
    for pattern, value in _YEAR_WORD_PATTERNS:
        if pattern.search(folded):
            years.add(value)
    return frozenset(years)


def has_attachment_heading(text: str) -> bool:
    """
    Vrai si la page porte un titre qui declare ou l'on est rattache.

    « ## Campus de rattachement » (EM Normandie) et « #### Campus d'affectation »
    (Em Lyon) le sont ; « ## Annee 1 : Pre-MSc » ne l'est pas — c'est un titre
    de programme d'annee. La difference est exactement celle qui separe une
    table de rattachement d'un plan de cursus.
    """
    for raw in _HEADING_LINE.findall(text or ""):
        heading = _fold_plain(raw)
        if any(marker in heading for marker in _ATTACHMENT_HEADING_MARKERS) and any(
            subject in heading for subject in _ATTACHMENT_HEADING_SUBJECT
        ):
            return True
    return False


def page_identities(text: str) -> frozenset[str]:
    """
    Cles repliees sous lesquelles cette page se nomme elle-meme.

    Titres de niveau 1 a 6 et elements du fil d'Ariane. Sert a rattacher un
    `program_name` rendu par le modele a la page d'ou il vient, puisque le
    schema d'extraction ne porte pas de `source_url` fiable — les 40 lignes
    d'Em Lyon de la sortie du 4 septembre l'ont toutes vide.
    """
    found = set()
    for pattern in (_HEADING_LINE, _BREADCRUMB_LINE):
        for raw in pattern.findall(text or ""):
            folded = _fold_plain(raw)
            if len(folded) >= 5:
                found.add(folded)
    return frozenset(found)


@dataclass(frozen=True)
class PageEvidence:
    """
    Ce que les pages lues portent reellement. Construit une fois par ecole.

    `cards` : cle repliee d'un titre -> les cartes ou ce titre est le texte
    d'un lien. Une carte est le couple (ancrage replie, href). Un titre qui
    n'est le texte d'aucun lien n'a AUCUNE carte : c'est le cas des cinq
    rubriques d'Em Lyon, dont le seul lien est un « Decouvrir » separe du
    titre par le blurb et les puces.
    """

    cards: dict[str, tuple[tuple[str, str], ...]] = field(default_factory=dict)
    identities: dict[str, frozenset[str]] = field(default_factory=dict)
    years: dict[str, frozenset[int]] = field(default_factory=dict)
    attachment_headings: frozenset[str] = frozenset()

    def pages_for(self, program_name: str) -> list[str]:
        """Pages lues qui se nomment comme ce programme, ou que sa carte vise."""
        key = _fold_plain(program_name)
        targets = {href.rstrip("/") for _, href in self.cards.get(key, ())}
        return sorted(
            url
            for url, names in self.identities.items()
            if key in names or url.rstrip("/") in targets
        )

    def pages_of(self, program_name: str, source_url: Optional[str]) -> list[str]:
        """
        Pages sur lesquelles confronter un enonce de ce programme.

        Le `source_url` rendu par le modele fait foi QUAND il designe une page
        reellement lue — c'est le cas des 199 enonces du corpus. Sinon on
        retombe sur les pages qui se nomment comme le programme, parce qu'un
        enonce sans page identifiable ne peut rien prouver.
        """
        if source_url and source_url in self.identities:
            return [source_url]
        return self.pages_for(program_name)

    def backing_cards(self, program_name: str, label: str) -> list[str]:
        """
        Hrefs des cartes qui portent A LA FOIS ce titre et ce lieu.

        C'est la garde 1, reduite a son enonce : une carte d'index n'est un
        programme que si son lien mene a une fiche — et la carte, c'est
        l'ancrage du lien, pas le voisinage typographique.
        """
        title = _fold_plain(program_name)
        place = fold_label(label)
        if not title or not place:
            return []
        return sorted(
            {href for anchor, href in self.cards.get(title, ()) if place in anchor}
        )


def build_page_evidence(pages: dict[str, str]) -> PageEvidence:
    """
    Depouille les pages deja lues. Aucun appel, aucune lecture de sens : des
    liens, des titres, des marqueurs d'annee.
    """
    cards: dict[str, list[tuple[str, str]]] = {}
    identities: dict[str, frozenset[str]] = {}
    years: dict[str, frozenset[int]] = {}
    with_heading: set[str] = set()

    for url, text in (pages or {}).items():
        identities[url] = page_identities(text)
        years[url] = published_years(text)
        if has_attachment_heading(text):
            with_heading.add(url)
        for anchor, href in _MD_LINK.findall(text or ""):
            href = href.strip().strip("<>")
            if not _href_is_usable(href):
                continue
            folded_anchor = _fold_plain(anchor)
            for line in anchor.split("\n"):
                title = _fold_plain(line)
                if len(title) >= 5:
                    cards.setdefault(title, []).append((folded_anchor, href))

    return PageEvidence(
        cards={key: tuple(value) for key, value in cards.items()},
        identities=identities,
        years=years,
        attachment_headings=frozenset(with_heading),
    )


# Mots qui, dans un encart, ne font que relier deux lieux. Fermes eux aussi.
_JOINING_WORDS = frozenset({"et", "ou", "and", "or", "-", "/", ",", "&", "+"})
# Separateurs internes : « Caen, Le Havre » enumere deux lieux, et la virgule
# interne n'est pas retiree par `fold_label`, qui ne touche qu'aux bords.
_INNER_SEPARATOR = re.compile(r"[,;·•/&+]")


def split_multi_campus_label(
    label: Optional[str], campus_folds: dict[str, str]
) -> list[str]:
    """
    Decoupe un encart qui enumere plusieurs campus DU PARC, ou rend [].

    « Caen Le Havre Paris Dublin Oxford » est publie comme une seule valeur dans
    l'encart des deux fiches PGE. Le modele l'a rendu tel quel, et il en est
    sorti une ligne `ProgramPlacement` dont le `label` ne designe aucun lieu.
    Sur la carte d'index de la meme ecole il l'a bien decoupe, d'ou des
    `ProgramCampus` corrects — par redondance, pas par robustesse.

    Le decoupage est rendu sur si, et seulement si, la LISTE DES CAMPUS le
    borne : on avance de gauche a droite en prenant a chaque pas le plus long
    nom de campus qui commence ici, et on n'accepte le resultat que si la
    chaine entiere est couverte par des campus et des mots de liaison. « Le
    Havre » est donc lu en un seul lieu, et une chaine qui laisse le moindre
    residu — « Lyon, France », « UniLaSalle Rouen », « campus Institut Lyfe avec
    une experience internationale » — est laissee intacte.

    La regle ne peut RIEN inventer : elle ne rend que des noms deja presents
    dans la liste passee en parametre. C'est ce qui la separe du decoupage
    d'une expression melant conjonction et disjonction (F14), qui n'a pas
    d'analyse unique et n'est pas tente ici.

    >>> folds = {"caen": "Caen", "le havre": "Le Havre", "paris": "Paris"}
    >>> split_multi_campus_label("Caen Le Havre Paris", folds)
    ['Caen', 'Le Havre', 'Paris']
    >>> split_multi_campus_label("Lyon, France", folds)
    []
    """
    # Tirets unifies comme dans les cles : « Saint‑Etienne » ecrit avec U+2011
    # doit rester un seul mot, egal a la cle « saint-etienne ».
    folded = _DASHES.sub("-", fold_label(label))
    if not folded or not campus_folds:
        return []
    words = [w for w in _INNER_SEPARATOR.sub(" ", folded).split(" ") if w]
    if len(words) < 2:
        return []
    longest = max((len(key.split(" ")) for key in campus_folds), default=1)

    found: list[str] = []
    position = 0
    while position < len(words):
        if words[position] in _JOINING_WORDS:
            position += 1
            continue
        matched = False
        for size in range(min(longest, len(words) - position), 0, -1):
            candidate = " ".join(words[position : position + size])
            if candidate in campus_folds:
                found.append(campus_folds[candidate])
                position += size
                matched = True
                break
        if not matched:
            return []

    # Un seul campus, c'est le travail de `match_campus`, pas celui-ci.
    if len(found) < 2:
        return []
    seen: list[str] = []
    for name in found:
        if name not in seen:
            seen.append(name)
    return seen


def campus_names_of(label: Optional[str], campus_folds: dict[str, str]) -> list[str]:
    """
    Campus du parc que ce libelle designe : zero, un, ou plusieurs.

    Une seule porte, pour que l'union `ProgramCampus` et le diagnostic F8
    lisent la meme chose d'un encart multi-lieux.
    """
    matched = match_campus(label, campus_folds)
    if matched is not None:
        return [matched]
    return split_multi_campus_label(label, campus_folds)


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


def apply_page_guards(
    statements: list[Statement], evidence: PageEvidence
) -> tuple[list[Statement], list[dict]]:
    """
    Confronte chaque enonce a la page. Rend (retenus, ecartes).

    Deux gardes, deux verdicts differents, et la difference est le fond du
    sujet — l'une nie l'existence du programme, l'autre nie seulement l'annee.

    **Garde 1 — une carte d'index n'est un programme que si son lien mene a une
    fiche.** Un enonce de zone `INDEX_CARD` est REJETE si aucune carte de la
    page ne porte a la fois le titre du programme et le lieu affirme. Sur la
    page catalogue d'Em Lyon, cinq rubriques — Gouvernance, Strategie,
    Management, Marketing, « Grades Masters & MSc » — sont typographiquement
    des cartes : un titre, un blurb, des puces dont une nomme « Paris ou
    Lyon », un lien « Decouvrir ». Elles n'en sont pas : le lien porte le mot
    « Decouvrir », pas le titre, et il vise une facette de recherche.

    Le raccourci « jeter tout programme dont les lignes ne viennent que de
    INDEX_CARD » est FAUX et il a ete mesure : il tue les cinq rubriques, mais
    aussi neuf programmes legitimes d'EM Normandie que seule leur carte fait
    connaitre, leur fiche n'ayant pas ete lue. C'est la carte qu'il faut
    qualifier, pas la zone.

    **Garde 2 — `SECTION` ne fait naitre une ligne-annee que si la page publie
    l'annee ET declare un rattachement.** Un enonce de zone `SECTION` est
    DEGRADE en `SECTION_UNDATED` si la page ne nomme pas son `study_year`, ou
    si aucune page du programme ne porte un titre de rattachement. Degrade, et
    non rejete : la page dit bien le lieu, elle ne dit pas l'annee. L'enonce
    garde donc son arete `ProgramCampus` et perd sa ligne fille — c'est
    exactement « zero ligne fille = le sens actuel, inchange ».

    Les trois Masteres Specialises d'Em Lyon sont le cas qui l'a motivee : des
    programmes de 12 mois, sans une seule mention d'annee, a qui le modele a
    donne six lignes `study_year = 1`. Deux d'entre eux portent pourtant bien
    un titre « Campus d'affectation » : le titre seul ne suffit donc pas, et
    c'est le marqueur d'annee qui tranche.
    """
    kept: list[Statement] = []
    dropped: list[dict] = []

    for stmt in statements:
        if stmt.zone == INDEX_CARD_ZONE:
            if stmt.label is None or not evidence.backing_cards(
                stmt.program_name, stmt.label
            ):
                dropped.append({
                    "guard": "card_without_fiche",
                    "program": stmt.program_name,
                    "zone": stmt.zone,
                    "label": stmt.label,
                    "verbatim": stmt.verbatim,
                    "effect": "enonce rejete : aucune carte liee a une fiche ne porte ce titre et ce lieu",
                })
                continue
            kept.append(stmt)
            continue

        if stmt.zone == SECTION_ZONE:
            pages = evidence.pages_of(stmt.program_name, stmt.source_url)
            years: frozenset[int] = frozenset()
            for url in pages:
                years |= evidence.years.get(url, frozenset())
            declared = any(u in evidence.attachment_headings for u in pages)
            reason = None
            if not pages:
                reason = "page_not_identified"
            elif not declared:
                reason = "no_attachment_heading"
            elif stmt.study_year > 0 and stmt.study_year not in years:
                reason = f"year_not_published:{stmt.study_year}"
            if reason is None:
                kept.append(stmt)
                continue
            if stmt.label is None:
                # Une annee sans lieu ET sans preuve d'annee n'affirme rien du
                # tout : elle ne merite meme pas un conflit `year_without_place`.
                dropped.append({
                    "guard": "section_unconfirmed",
                    "program": stmt.program_name,
                    "zone": stmt.zone,
                    "study_year": stmt.study_year,
                    "reason": reason,
                    "verbatim": stmt.verbatim,
                    "effect": "enonce rejete : ni lieu, ni annee publiee",
                })
                continue
            dropped.append({
                "guard": "section_unconfirmed",
                "program": stmt.program_name,
                "zone": stmt.zone,
                "study_year": stmt.study_year,
                "label": stmt.label,
                "reason": reason,
                "verbatim": stmt.verbatim,
                "effect": "zone degradee : arete ProgramCampus conservee, aucune ligne fille",
            })
            kept.append(
                Statement(
                    program_name=stmt.program_name,
                    zone=SECTION_UNDATED_ZONE,
                    study_year=0,
                    regime=stmt.regime,
                    label=stmt.label,
                    languages=stmt.languages,
                    verbatim=stmt.verbatim,
                    source_url=stmt.source_url,
                )
            )
            continue

        kept.append(stmt)

    return kept, dropped


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

    `campus_folds` : cle `fold_campus_name()` -> nom du campus tel que la table
    `Campus` l'ecrit. C'est la liste des campus REELS ; `campusName` rend donc
    le nom de la base, pas celui de la page.
    """
    section = [s for s in statements if s.zone == SECTION_ZONE]
    fieldish = [s for s in statements if s.zone in FIELD_ZONES]
    prose = [s for s in statements if s.zone == PROSE_ZONE]
    undated = [s for s in statements if s.zone == SECTION_UNDATED_ZONE]
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
        # Un encart peut enumerer plusieurs campus du parc dans une seule
        # valeur. `campus_names_of` tente le decoupage apres l'echec de
        # `match_campus`, et ne rend que des noms deja dans la liste fournie.
        names = campus_names_of(stmt.label, campus_folds)
        if names:
            for name in names:
                entry = campus_seen.setdefault(
                    fold_campus_name(name), {"zones": set(), "spellings": [], "source_url": None}
                )
                entry["zones"].add(stmt.zone)
                entry["spellings"].append(name)
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
            fold_campus_name(name)
            for s in section
            for name in campus_names_of(s.label, campus_folds)
        }
        field_folds = {
            fold_campus_name(name)
            for s in fieldish
            for name in campus_names_of(s.label, campus_folds)
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
            (fold_campus_name(matched), stmt.study_year, stmt.regime), []
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
        "has_prose_only": bool(prose) and not has_section and not fieldish and not undated,
        "program_campus": program_campus,
        "program_campus_attachment": attachment_rows,
        "program_placement": placement_rows,
        "conflicts": conflicts,
        "spelling_merges": spelling_merges,
    }


def build_rows(
    raw: Any,
    campuses: list[str],
    pages: Optional[dict[str, str]] = None,
) -> dict:
    """
    Sortie complete pour une ecole : les lignes des trois tables, programme par
    programme, plus ce qui a ete rejete et ce qui se contredit.

    `campuses` est la liste des campus REELS de l'ecole : les noms de la table
    `Campus`, tels quels. `--campus` ne sert plus qu'a rejouer le cache.

    Deux noms qui se replient sur la meme cle — « Paris » et « Paris campus »
    pour une meme ecole, que `@@unique([schoolId, name])` laisse coexister —
    ne reconnaissent plus RIEN : un choix entre les deux serait un
    appariement devine. Ils sont rendus dans `campus_key_collisions`, et leurs
    lignes tombent en ProgramPlacement, le sens sur.

    `pages` est le markdown des pages LUES, {url: texte}. Quand il est fourni,
    les deux gardes de `apply_page_guards` s'appliquent : le modele propose, la
    page dispose. Quand il ne l'est pas, la sortie est celle d'avant les
    gardes — c'est ce qui permet de mesurer l'ecart plutot que de l'annoncer.
    """
    names_by_key: dict[str, list[str]] = {}
    for name in campuses:
        key = fold_campus_name(name)
        if key:
            names_by_key.setdefault(key, [])
            if name.strip() not in names_by_key[key]:
                names_by_key[key].append(name.strip())
    campus_folds = {key: names[0] for key, names in names_by_key.items() if len(names) == 1}
    collisions = {key: sorted(names) for key, names in sorted(names_by_key.items()) if len(names) > 1}

    statements, rejected = parse_statements(raw)

    evidence = build_page_evidence(pages) if pages else None
    guarded: list[dict] = []
    if evidence is not None:
        statements, guarded = apply_page_guards(statements, evidence)

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

    output = {
        "campuses_supplied": [campus_folds[f] for f in sorted(campus_folds)],
        "programs": programs,
        "rejected_statements": rejected,
        "guarded_statements": guarded,
        "pages_checked": len(pages or {}),
        "totals": {
            "programs": len(programs),
            "statements_kept": len(statements),
            "statements_rejected": len(rejected),
            "statements_guarded": len(guarded),
            "program_campus": sum(len(p["program_campus"]) for p in programs),
            "program_campus_attachment": sum(
                len(p["program_campus_attachment"]) for p in programs
            ),
            "program_placement": sum(len(p["program_placement"]) for p in programs),
            "conflicts": sum(len(p["conflicts"]) for p in programs),
        },
    }
    # Rendu seulement quand il y a lieu : une sortie sans collision garde la
    # forme exacte d'avant, ce qui laisse comparer les rejeux octet pour octet.
    if collisions:
        output["campus_key_collisions"] = collisions
    return output
