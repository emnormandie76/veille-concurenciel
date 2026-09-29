"""
backend/ai/extraction_schemas.py — JSON Schemas de la couche d'extraction

Ces schémas ne partent PLUS chez Tavily. Ils sont passés à Gemini en
`response_json_schema`, une fois le rapport de recherche rédigé. La différence
est le cœur du chantier : envoyé à Tavily en `output_schema`, un schéma
écourtait la recherche — l'agent cessait de chercher dès qu'il pouvait remplir
les champs `required`, et rendait 1 classement au lieu de 14. Envoyé à Gemini
après coup, le même schéma ne fait que contraindre le décodage.

Ils remplacent backend/ai/research_schemas.py, dont ils reprennent les
descriptions de champs — c'est le travail de cadrage qui, lui, était bon.

## Deux règles qui gouvernent tout ce fichier

**1. Un objet du schéma = une ligne future en base.** Chaque schéma est calqué
sur la contrainte `@@unique` de sa table Prisma. RankingRecord est unique sur
(programId, academic_year, ranking_name) : la base sait stocker N classements
par programme et par an, donc le schéma rend un TABLEAU. L'ancien schéma
décrivait un classement unique — même quand Tavily trouvait tout, neuf
classements sur dix étaient jetés à la sortie.

**2. Tout champ optionnel se déclare `{"type": ["integer", "null"]}`**, jamais
`{"type": "integer"}` seul. Sans l'union, un modèle qui ne sait pas n'a que deux
issues : omettre le champ, ou inventer une valeur. C'est l'origine des `null`
manquants ET des années `0` qui sont un jour parties en production comme des
données réelles (voir le commentaire de AccreditationRecord.year_obtained dans
prisma/schema.prisma).

Référence : dossier « Le rapport avant le schéma », section 08.
"""

import copy
import re
import unicodedata

# ── Phase 1 · Program_Discovery ───────────────────────────────────
#
# Tables visées : Campus (@@unique[schoolId, name]) et Program
# (@@unique[schoolId, name]), reliés par ProgramCampus.
#
# La forme imbriquée est conservée : la route de validation la gère déjà, et
# elle porte l'information « ce programme est enseigné sur ce campus », qui est
# exactement ce que ProgramCampus matérialise.
#
# Deux ajouts par rapport à research_schemas.PHASE1_OUTPUT_SCHEMA :
#   - unions null sur les trois champs qualitatifs, qui sortaient vides 12 fois
#     sur 12 sous output_schema ;
#   - `programs` reste requis, mais le pipeline refuse désormais un campus au
#     tableau vide — `required: ["name", "programs"]` était satisfait par [],
#     et Dubaï comme Ho Chi Minh City passaient la validation sans un seul
#     programme.
PHASE1_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "discovered_campuses": {
            "type": "array",
            "description": "Tous les campus de l'école, un objet par campus.",
            "items": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": (
                            "Nom exact du campus tel qu'écrit par l'école "
                            "(ex: 'Campus Paris La Défense'). À défaut de nom "
                            "distinct : 'Campus [Ville]'."
                        ),
                    },
                    "city": {
                        "type": ["string", "null"],
                        "description": "Ville du campus, null si le rapport ne la donne pas.",
                    },
                    "programs": {
                        "type": "array",
                        "description": (
                            "Formations diplômantes enseignées sur CE campus. "
                            "Jamais un libellé de rubrique de menu."
                        ),
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {
                                    "type": "string",
                                    "description": (
                                        "Intitulé exact de la formation "
                                        "(ex: 'Programme Grande École', 'IBBA'). "
                                        "Reprendre le catalogue de l'école quand "
                                        "il est fourni."
                                    ),
                                },
                                "admission_exam": {
                                    "type": ["string", "null"],
                                    "description": (
                                        "Concours d'entrée (ex: 'Concours SESAME', "
                                        "'Parcoursup', 'Sur dossier'), null si le "
                                        "rapport ne le dit pas."
                                    ),
                                },
                                "is_alternance_possible": {
                                    "type": ["boolean", "null"],
                                    "description": (
                                        "L'alternance est-elle possible ? null si "
                                        "le rapport ne se prononce pas."
                                    ),
                                },
                                "is_expatriation_mandatory": {
                                    "type": ["boolean", "null"],
                                    "description": (
                                        "Un séjour à l'étranger est-il obligatoire "
                                        "pour valider le diplôme ? null si inconnu."
                                    ),
                                },
                                "min_expatriation_months": {
                                    "type": ["integer", "null"],
                                    "description": "Durée minimale d'expatriation en mois, null si inconnue.",
                                },
                                "max_internship_months": {
                                    "type": ["integer", "null"],
                                    "description": "Durée maximale de stage en mois, null si inconnue.",
                                },
                                "source_url": {
                                    "type": ["string", "null"],
                                    "description": "URL citée par le rapport pour cette formation.",
                                },
                            },
                            "required": ["name"],
                        },
                    },
                },
                "required": ["name", "programs"],
            },
        },
        "source_urls": {
            "type": "array",
            "description": "URLs des pages citées par le rapport.",
            "items": {"type": "string"},
        },
        "confidence_notes": {
            "type": ["string", "null"],
            "description": (
                "Conflits entre sources et incertitudes relevés par le rapport "
                "(ex: désaccord sur le nombre de campus). null si aucun."
            ),
        },
    },
    "required": ["discovered_campuses"],
}


# ── Phase 2 · Pricing ─────────────────────────────────────────────
#
# Table visée : PricingRecord, @@unique([programId, academic_year]).
# Un enregistrement par couple programme-année : la forme objet est correcte,
# c'est le seul schéma de la Phase 2 qui reste un objet.
PRICING_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "academic_year": {
            "type": ["integer", "null"],
            "description": "Année de début de l'année scolaire (2026 pour 2026-2027).",
        },
        "currency": {
            "type": ["string", "null"],
            "description": "Devise des frais (EUR par défaut).",
        },
        "year_1_fee": {"type": ["integer", "null"], "description": "Frais de l'année 1."},
        "year_2_fee": {"type": ["integer", "null"], "description": "Frais de l'année 2."},
        "year_3_fee": {"type": ["integer", "null"], "description": "Frais de l'année 3."},
        "year_4_fee": {"type": ["integer", "null"], "description": "Frais de l'année 4."},
        "year_5_fee": {"type": ["integer", "null"], "description": "Frais de l'année 5."},
        "total_fee": {
            "type": ["integer", "null"],
            "description": (
                "Coût total du cursus. À remplir UNIQUEMENT si le rapport donne "
                "un total explicite, ou si toutes les années sont publiées et "
                "peuvent être additionnées. Jamais une extrapolation."
            ),
        },
        "intl_year_1_fee": {
            "type": ["integer", "null"],
            "description": (
                "Frais année 1 pour un étudiant hors UE. À remplir UNIQUEMENT si "
                "le rapport annonce explicitement un tarif distinct. Recopier le "
                "tarif UE ici est une erreur observée en test."
            ),
        },
        "intl_total_fee": {
            "type": ["integer", "null"],
            "description": "Coût total hors UE, aux mêmes conditions que intl_year_1_fee.",
        },
        "intl_currency": {
            "type": ["string", "null"],
            "description": "Devise des frais hors UE si elle diffère.",
        },
        "additional_fees_notes": {
            "type": ["string", "null"],
            "description": (
                "Frais annexes cités : CVEC, frais de dossier, concours, "
                "cotisation alumni, arrhes, Parcoursup…"
            ),
        },
        "source_url": {
            "type": ["string", "null"],
            "description": "URL principale citée par le rapport pour ces tarifs.",
        },
        "year_assumed": {
            "type": "boolean",
            "description": "true si l'année scolaire a été déduite et non lue.",
        },
        "data_conflict_warning": {
            "type": "boolean",
            "description": (
                "true si le rapport signale des tarifs contradictoires entre "
                "sources — sa section « Conflits et incertitudes » sert à ça."
            ),
        },
    },
    "required": ["academic_year", "currency"],
}


# ── Phase 2 · Ranking ─────────────────────────────────────────────
#
# Table visée : RankingRecord, @@unique([programId, academic_year, ranking_name]).
# Le changement structurant du chantier : un TABLEAU, une entrée par ligne
# future.
#
# `ranking_name` est un enum fermé, et ce n'est pas du confort. En texte libre,
# l'extraction a produit « L'Etudiant's 2025 ranking of best post-bac business
# schools in 5 years » et « L'Étudiant » pour le même palmarès : deux lignes en
# base au regard de la contrainte d'unicité, et un ticket recréé à chaque
# passage du cron parce que le module de diff ne reconnaîtra jamais l'existant.
#
# `scope` et `program_hint` existent parce que Ranking passe au niveau école :
# un seul rapport couvre tout le paysage médiatique, et l'extraction ventile
# ensuite par programme.
RANKING_NAME_ENUM = [
    "Le Figaro Étudiant",
    "L'Étudiant",
    "Le Parisien Étudiant",
    "Le Point",
    "Challenges",
    "SIGEM",
    "Financial Times",
    "QS",
    "Autre",
]

RANKING_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "rankings": {
            "type": "array",
            "description": (
                "TOUS les classements cités par le rapport, un objet par "
                "couple (média, année). Ne jamais n'en garder qu'un."
            ),
            "items": {
                "type": "object",
                "properties": {
                    "ranking_name": {
                        "type": "string",
                        "enum": RANKING_NAME_ENUM,
                        "description": (
                            "Média du palmarès, normalisé sur cette liste. "
                            "'Autre' pour un classement légitime hors liste — "
                            "son libellé d'origine va dans ranking_label."
                        ),
                    },
                    "ranking_label": {
                        "type": ["string", "null"],
                        "description": (
                            "Libellé exact du palmarès tel qu'écrit dans le "
                            "rapport. Sert à retrouver l'original quand "
                            "ranking_name vaut 'Autre'."
                        ),
                    },
                    "rank": {
                        "type": "integer",
                        "description": "Rang obtenu, entier.",
                    },
                    "academic_year": {
                        "type": "integer",
                        "description": (
                            "Année du palmarès telle qu'annoncée par le média "
                            "(2025 pour le palmarès 2025). Jamais 0."
                        ),
                    },
                    "scope": {
                        "type": "string",
                        "enum": ["program", "school"],
                        "description": (
                            "'program' si le classement porte sur une formation "
                            "précise, 'school' s'il classe l'établissement entier."
                        ),
                    },
                    "program_hint": {
                        "type": ["string", "null"],
                        "description": (
                            "Nom du programme concerné quand scope vaut "
                            "'program', tel qu'écrit dans le rapport. Sert à "
                            "rattacher le classement au bon Program."
                        ),
                    },
                    "total_ranked": {
                        "type": ["integer", "null"],
                        "description": "Nombre d'établissements classés, null si absent.",
                    },
                    "source_url": {
                        "type": ["string", "null"],
                        "description": "URL de la page du palmarès.",
                    },
                    "data_conflict_warning": {
                        "type": "boolean",
                        "description": "true si le rapport signale un désaccord sur ce rang.",
                    },
                },
                "required": ["ranking_name", "rank", "academic_year", "scope"],
            },
        }
    },
    "required": ["rankings"],
}

# Valeur de `program_hint` quand la formation classée n'est aucun des
# programmes fournis. Une chaîne de l'enum plutôt que `null` : l'enum ferme le
# choix, et le modèle doit pouvoir dire « aucun » sans sortir de la liste.
NO_PROGRAM_HINT = "Aucun programme de la liste"


def ranking_extraction_schema(program_names: list[str]) -> dict:
    """
    Schéma Ranking dont `program_hint` est fermé sur les programmes de l'école.

    En texte libre, `program_hint` reprenait l'écriture du rapport — « PGE
    post-bac », « Bachelor en Management » — et le rattachement en Python
    perdait ces classements ou les collait au mauvais programme. C'est le modèle,
    qui lit le rapport, qui choisit le programme ; l'admin relit ensuite chaque
    ticket. Sans programme connu, le schéma générique est rendu tel quel.
    """
    names = list(dict.fromkeys(n for n in program_names if n))
    if not names:
        return RANKING_EXTRACTION_SCHEMA
    schema = copy.deepcopy(RANKING_EXTRACTION_SCHEMA)
    schema["properties"]["rankings"]["items"]["properties"]["program_hint"] = {
        "type": "string",
        "enum": names + [NO_PROGRAM_HINT],
        "description": (
            "Programme classé, copié à l'identique de la liste. "
            f"'{NO_PROGRAM_HINT}' si la formation classée n'y figure pas, "
            "ou si scope vaut 'school'."
        ),
    }
    return schema


def _fold(text: str) -> str:
    text = unicodedata.normalize("NFD", text or "")
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return " " + re.sub(r"[^a-z0-9]+", " ", text.lower()).strip() + " "


# Ordre significatif : Le Figaro Étudiant et Le Parisien Étudiant contiennent
# « étudiant », donc ils passent avant L'Étudiant.
_RANKING_NAME_MARKERS: list[tuple[tuple[str, ...], str]] = [
    ((" figaro ",), "Le Figaro Étudiant"),
    ((" parisien ",), "Le Parisien Étudiant"),
    ((" sigem ",), "SIGEM"),
    ((" financial times ", " ft "), "Financial Times"),
    ((" qs ",), "QS"),
    ((" challenges ",), "Challenges"),
    ((" le point ",), "Le Point"),
    ((" l etudiant ", " letudiant "), "L'Étudiant"),
]


def canonical_ranking_name(name: str | None) -> str | None:
    """
    Nom d'un média de classement ramené sur RANKING_NAME_ENUM quand il en est un.

    Gemma, qui extrait les contributions, ne sait pas contraindre sa sortie à un
    enum. Sans ce repli, « Le Figaro » (contribution) et « Le Figaro Étudiant »
    (pipeline) faisaient deux lignes RankingRecord pour le même palmarès. Un nom
    qui n'est aucun de ces médias est rendu tel quel.
    """
    if not name or not name.strip():
        return name
    folded = _fold(name)
    for markers, canonical in _RANKING_NAME_MARKERS:
        if any(marker in folded for marker in markers):
            return canonical
    return name.strip()


# ── Phase 2 · Capacity ────────────────────────────────────────────
#
# Table visée : CapacityRecord, @@unique([programCampusId, academic_year]).
#
# La base ne garde qu'un total par couple programme-campus et par an, mais les
# places se déclinent par voie d'admission (SESAME, ACCÈS, Parcoursup,
# admissions parallèles). Extraire le détail et laisser l'admin recomposer le
# total à la validation, c'est arbitrer sur pièces plutôt que sur un chiffre
# dont personne ne sait ce qu'il agrège.
CAPACITY_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "capacities": {
            "type": "array",
            "description": (
                "Une entrée par voie d'admission documentée. Si le rapport ne "
                "donne qu'un total toutes voies confondues, une seule entrée "
                "avec admission_channel = 'Toutes voies'."
            ),
            "items": {
                "type": "object",
                "properties": {
                    "spots_available": {
                        "type": "integer",
                        "description": (
                            "Nombre de places pour cette voie. 0 est une valeur "
                            "valide (formation fermée) — ne pas confondre avec "
                            "une absence d'information."
                        ),
                    },
                    "academic_year": {
                        "type": "integer",
                        "description": "Année de début de l'année scolaire concernée.",
                    },
                    "admission_channel": {
                        "type": ["string", "null"],
                        "description": (
                            "Voie d'admission : 'SESAME', 'ACCÈS', 'Parcoursup', "
                            "'Admissions parallèles', 'Toutes voies'…"
                        ),
                    },
                    "source_url": {
                        "type": ["string", "null"],
                        "description": "URL de la page citée pour ce chiffre.",
                    },
                    "year_assumed": {
                        "type": "boolean",
                        "description": "true si l'année a été déduite et non lue.",
                    },
                },
                "required": ["spots_available", "academic_year"],
            },
        }
    },
    "required": ["capacities"],
}


# ── Phase 2 · SchoolStats ─────────────────────────────────────────
#
# Table visée : SchoolStatsRecord, @@unique([schoolId, academic_year]).
# Un enregistrement par école et par an : la forme objet est correcte.
SCHOOL_STATS_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "academic_year": {
            "type": ["integer", "null"],
            "description": "Année de référence des chiffres.",
        },
        "total_students": {"type": ["integer", "null"], "description": "Étudiants inscrits."},
        "total_alumni": {"type": ["integer", "null"], "description": "Diplômés (alumni)."},
        "partner_companies": {"type": ["integer", "null"], "description": "Entreprises partenaires."},
        "annual_internship_offers": {
            "type": ["integer", "null"],
            "description": "Offres de stage reçues annuellement.",
        },
        "abroad_campuses": {"type": ["integer", "null"], "description": "Campus à l'étranger."},
        "partner_universities": {
            "type": ["integer", "null"],
            "description": "Universités partenaires internationales.",
        },
        "permanent_professors": {
            "type": ["integer", "null"],
            "description": "Enseignants-chercheurs permanents.",
        },
        "international_professors_pct": {
            "type": ["number", "null"],
            "description": "Part de professeurs internationaux, en points de 0 à 100 (46 pour 46 %).",
        },
        "external_speakers_pct": {
            "type": ["number", "null"],
            "description": "Part d'intervenants extérieurs, en points de 0 à 100.",
        },
        "source_url": {"type": ["string", "null"], "description": "URL principale citée."},
        "year_assumed": {
            "type": "boolean",
            "description": "true si l'année a été déduite et non lue.",
        },
        "data_conflict_warning": {
            "type": "boolean",
            "description": "true si le rapport signale des chiffres contradictoires.",
        },
    },
    "required": ["academic_year"],
}


# ── Phase 2 · Accreditation ───────────────────────────────────────
#
# Table visée : AccreditationRecord, @@unique([schoolId, accreditation_name]).
# Déjà un tableau dans research_schemas — c'était le modèle à suivre. Repris
# tel quel, avec les unions null ajoutées.
ACCREDITATION_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "accreditations": {
            "type": "array",
            "description": "TOUTES les accréditations et labels cités par le rapport.",
            "items": {
                "type": "object",
                "properties": {
                    "accreditation_name": {
                        "type": "string",
                        "description": "Nom exact (ex: 'EQUIS', 'AACSB', 'CGE', 'Grade de Master').",
                    },
                    "accreditation_type": {
                        "type": "string",
                        "enum": ["international", "label", "state"],
                        "description": (
                            "'international' : EQUIS, AACSB, AMBA, EPAS, BSIS, ABET. "
                            "'state' : Grade de Licence/Master, CTI, CEFDG, HCERES. "
                            "'label' : CGE, EESPIG, Qualiopi, DD&RS, et tout le reste."
                        ),
                    },
                    "year_obtained": {
                        "type": ["integer", "null"],
                        "description": (
                            "Année d'obtention ou de renouvellement. null si "
                            "inconnue — JAMAIS 0 : l'année 0 est déjà partie en "
                            "production comme une donnée réelle."
                        ),
                    },
                    "is_active": {
                        "type": "boolean",
                        "description": "true sauf mention explicite d'expiration ou de retrait.",
                    },
                    "source_url": {
                        "type": ["string", "null"],
                        "description": "URL citée pour cette accréditation.",
                    },
                },
                "required": ["accreditation_name", "accreditation_type", "is_active"],
            },
        }
    },
    "required": ["accreditations"],
}


# ── Phase 1 · passe catalogue ─────────────────────────────────────
#
# Ne vise aucune table : c'est une étape intermédiaire. La liste produite ici
# devient la référence passée au prompt Program_Discovery, pour que le modèle
# RATTACHE les formations du rapport au lieu d'en inventer les intitulés.
#
# Le premier essai extrayait ces titres par expression régulière taillée pour le
# balisage d'un site précis. Ça ne généralise pas — d'où un schéma et un modèle,
# qui lisent une page quelle que soit sa mise en forme.
CATALOG_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "programs": {
            "type": "array",
            "description": "Formations diplômantes listées par la page catalogue.",
            "items": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Intitulé exact tel qu'il figure sur la page.",
                    },
                    "url": {
                        "type": ["string", "null"],
                        "description": "Lien vers la fiche de la formation, si la page en donne un.",
                    },
                },
                "required": ["name"],
            },
        },
        "catalog_url": {
            "type": ["string", "null"],
            "description": "URL de la page d'index effectivement lue.",
        },
    },
    "required": ["programs"],
}


# ── Phase 1 · rattachement programme <-> lieu ─────────────────────
#
# Tables visees : ProgramCampus (inchangee), ProgramCampusAttachment
# (@@unique[programCampusId, study_year, regime]) et ProgramPlacement
# (@@unique[programId, study_year, regime, label]).
#
# ## Pourquoi un tableau plat d'ENONCES et pas trois tableaux
#
# La regle 1 du fichier — un objet du schema = une ligne future en base — se
# heurte ici a trois tables. La resoudre en demandant au modele de choisir sa
# table reviendrait a lui faire trancher `kind`, or c'est precisement ce qu'il
# ne peut pas savoir : « Shanghai » est un campus d'Em Lyon, « Milan » ne l'est
# pas, et la fiche les publie dans le meme champ avec le meme separateur.
#
# Le modele rend donc UN enonce de lieu par objet — sa forme minimale telle
# qu'elle est publiee — et l'aiguillage vers les trois tables se fait ensuite,
# en Python, avec la liste des campus reels de l'ecole. Un objet reste bien une
# ligne : c'est sa table de destination qui est calculee.
#
# ## `zone` est le champ qui rend F8 observable
#
# Les deux fiches PGE d'EM Normandie se contredisent entre leur encart et leur
# section « Campus de rattachement », dans les deux sens a la fois : Le Havre
# est dans l'encart et absent de la section, Dubai est dans la section et
# absent de l'encart. Sans `zone`, les deux affirmations arrivent melangees et
# la contradiction devient invisible — on ne peut plus ni arbitrer, ni compter
# les desaccords. C'est le seul champ du schema qui n'existe pas pour la base
# mais pour la mesure.
CAMPUS_STATEMENT_ZONES = ["FIELD", "INDEX_CARD", "SECTION", "PROSE"]

CAMPUS_STATEMENT_REGIMES = ["ANY", "INITIAL", "ALTERNANCE"]

CAMPUS_ATTACHMENT_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "statements": {
            "type": "array",
            "description": (
                "Un objet par ENONCE DE LIEU elementaire. Une ligne « Dubai, "
                "Dublin ou Oxford - cours en anglais » vaut TROIS objets, un "
                "par lieu, portant la meme langue et le meme verbatim."
            ),
            "items": {
                "type": "object",
                "properties": {
                    "program_name": {
                        "type": "string",
                        "description": (
                            "Intitule exact du programme tel qu'il est ecrit "
                            "sur la page. Jamais un libelle de rubrique."
                        ),
                    },
                    "zone": {
                        "type": "string",
                        "enum": CAMPUS_STATEMENT_ZONES,
                        "description": (
                            "Ou l'enonce est publie. 'FIELD' : encart a champs "
                            "nommes de la fiche (etiquette Campus). "
                            "'INDEX_CARD' : carte de la page d'index. "
                            "'SECTION' : section « Campus de rattachement », "
                            "celle qui donne l'annee. 'PROSE' : au fil du "
                            "texte. Ne devine JAMAIS cette valeur : elle dit "
                            "d'ou tu lis, pas ce que tu crois."
                        ),
                    },
                    "study_year": {
                        "type": "integer",
                        "description": (
                            "1 pour la 1re annee, 2 pour la 2e... 0 quand "
                            "l'enonce ne nomme aucune annee — c'est le cas de "
                            "tout l'encart. Une plage annoncee en bloc "
                            "(« 4e et 5e annees ») donne un objet par annee."
                        ),
                    },
                    "regime": {
                        "type": "string",
                        "enum": CAMPUS_STATEMENT_REGIMES,
                        "description": (
                            "'INITIAL' ou 'ALTERNANCE' UNIQUEMENT quand la "
                            "page publie deux listes de lieux distinctes pour "
                            "cette annee. 'ANY' partout ailleurs, y compris "
                            "quand la page dit « formation initiale » sans "
                            "opposer de seconde liste."
                        ),
                    },
                    "label": {
                        "type": ["string", "null"],
                        "description": (
                            "Le lieu TEL QUE LA PAGE L'ECRIT : « Le Havre », "
                            "« Universite partenaire », « Online », "
                            "« UniLaSalle Rouen », « International ». Ne "
                            "traduis pas, ne corrige pas l'orthographe, "
                            "n'ajoute pas « Campus de ». Une expression que tu "
                            "ne sais pas decouper (« Paris et New York ou "
                            "Londres ») reste ENTIERE dans un seul objet. "
                            "null UNIQUEMENT quand la page nomme une annee et "
                            "declare explicitement n'en publier aucun lieu."
                        ),
                    },
                    "languages": {
                        "type": "array",
                        "description": (
                            "Langues d'enseignement attachees a CET enonce, en "
                            "code court majuscule : FR, EN, ES, DE, IT, ZH. "
                            "« cours en anglais ou en francais » donne "
                            "['EN','FR']. Tableau vide si la page ne le dit "
                            "pas pour ce lieu — n'herite jamais de la langue "
                            "d'une autre annee."
                        ),
                        "items": {"type": "string"},
                    },
                    "verbatim": {
                        "type": ["string", "null"],
                        "description": (
                            "La ligne source, recopiee telle quelle, sans "
                            "reformulation. C'est la piece qui permet de "
                            "verifier l'objet sans rouvrir la page."
                        ),
                    },
                    "source_url": {
                        "type": ["string", "null"],
                        "description": (
                            "URL de la page d'ou vient l'enonce, reprise du "
                            "marqueur « ## Source: » qui precede le bloc."
                        ),
                    },
                },
                "required": ["program_name", "zone", "study_year", "regime", "label"],
            },
        },
        "policies": {
            "type": "array",
            "description": (
                "Les phrases qui posent une CONTRAINTE au-dessus de la liste "
                "des lieux, sans etre elles-memes une liste de lieux. Une "
                "seule observee sur 51 enonces, celle de l'IBBA. Vide le plus "
                "souvent."
            ),
            "items": {
                "type": "object",
                "properties": {
                    "program_name": {
                        "type": "string",
                        "description": "Programme concerne, meme intitule que dans statements.",
                    },
                    "policy_note": {
                        "type": "string",
                        "description": (
                            "La phrase recopiee telle quelle. Elle va dans "
                            "Program.campus_policy_note, que l'admin lit ; "
                            "aucune requete ne s'appuie dessus."
                        ),
                    },
                    "source_url": {
                        "type": ["string", "null"],
                        "description": "URL de la page qui porte la phrase.",
                    },
                },
                "required": ["program_name", "policy_note"],
            },
        },
    },
    "required": ["statements"],
}

# ── Aiguillage par catégorie ──────────────────────────────────────
#
# Plancher de qualité par catégorie (voir gemini_client.MODEL_LADDER).
# 20 requêtes par jour sur les modèles de tête : ils sont un budget rare à
# dépenser sur les extractions ambiguës, pas un défaut à utiliser partout.
#
#   high — arbitrages multiples, ventilation par programme, hallucinations
#          possibles sur les tarifs hors UE
#   low  — champs plats, peu d'interprétation : entrer directement au niveau
#          flash-lite préserve le budget haut
EXTRACTION_SCHEMAS: dict[str, dict] = {
    "Program_Discovery": PHASE1_EXTRACTION_SCHEMA,
    "Pricing": PRICING_EXTRACTION_SCHEMA,
    "Ranking": RANKING_EXTRACTION_SCHEMA,
    "Capacity": CAPACITY_EXTRACTION_SCHEMA,
    "SchoolStats": SCHOOL_STATS_EXTRACTION_SCHEMA,
    "Accreditation": ACCREDITATION_EXTRACTION_SCHEMA,
    "Campus_Attachment": CAMPUS_ATTACHMENT_EXTRACTION_SCHEMA,
}

# `min_tier` est un PLANCHER, pas un point de départ. La cascade part toujours
# du haut de MODEL_LADDER ; ce réglage dit seulement jusqu'où elle a le droit de
# descendre.
#
# Ces trois catégories étaient à "high", ce qui confondait les deux notions et
# ne laissait que trois modèles éligibles. Mesuré en production le 2026-09-03 :
# 3.8-flash et 3.7-flash ont répondu 503 sur quasiment chaque appel de la
# journée, et un run de Phase 1 a échoué entièrement quand 3.6-flash a lâché à
# son tour — alors que cinq modèles sains attendaient plus bas.
#
# "mid" garde le refus du flash-lite pour les extractions à arbitrages, et rien
# n'indique que ce soit un sacrifice : sur la tâche réelle d'extraction de
# classements, 3-flash-preview a rendu 13 classements et 3.5-flash 10, contre 9
# pour 3.7-flash. Les paliers hauts sont plus rares, pas nécessairement
# meilleurs ici.
MIN_TIER_BY_CATEGORY: dict[str, str] = {
    "Program_Discovery": "mid",
    "Ranking": "mid",
    "Pricing": "mid",
    "SchoolStats": "low",
    "Accreditation": "low",
    "Capacity": "low",
    # Lecture d'encart, pas synthese : le modele recopie une etiquette et sa
    # valeur, et le seul arbitrage (campus du parc ou lieu d'un tiers) lui est
    # retire — il est fait en Python avec la liste des campus reels. Rien ici
    # ne justifie le budget rare des paliers hauts, d'autant que la collecte
    # groupe plusieurs fiches par appel pour tenir le portillon de 12 s.
    "Campus_Attachment": "low",
}

# Catégories dont l'extraction rend un tableau : le pipeline crée alors un
# ticket par entrée, reliés par submission_group_id.
ARRAY_RESULT_KEYS: dict[str, str] = {
    "Ranking": "rankings",
    "Capacity": "capacities",
}


def get_extraction_schema(category: str) -> dict:
    """Schéma d'extraction d'une catégorie."""
    try:
        return EXTRACTION_SCHEMAS[category]
    except KeyError:
        raise ValueError(f"Catégorie inconnue: {category}") from None


def get_min_tier(category: str) -> str:
    """Plancher de qualité Gemini d'une catégorie."""
    return MIN_TIER_BY_CATEGORY.get(category, "low")
