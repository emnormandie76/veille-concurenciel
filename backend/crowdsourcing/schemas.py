"""
backend/crowdsourcing/schemas.py — JSON Schemas de l'extraction des contributions

Le crowdsourcing passe par la cascade Gemini du pipeline (`extract_structured`),
qui contraint le décodage par `response_json_schema`. Mais la forme d'un ticket
de contribution n'est pas toujours celle d'un ticket du pipeline, et `validate`
et l'inbox lisent la forme des tickets de contribution :

  - Pricing et SchoolStats : un objet plat, identique des deux côtés. Les
    schémas du pipeline (backend/ai/extraction_schemas.py) servent tels quels ;
  - Accreditation : un objet à clé `accreditations[]`, la forme que produit
    déjà la Phase 2 (C1) : les schémas du pipeline servent tels quels ;
  - Ranking et Capacity : le pipeline rend un TABLEAU (`rankings[]`,
    `capacities[]`, un objet par ligne future), alors qu'une contribution
    mono-programme est un objet plat. Schémas propres ci-dessous ;
  - mode multi-programme (Pricing, Ranking, Capacity sans `programId`) :
    `{"programs": [{"program_name", ...}]}`, que `validateMultiProgram` relit.
    Schémas propres.

Les champs optionnels sont des unions `null` (règle 2 de extraction_schemas.py) :
un modèle qui ne sait pas dit `null` au lieu d'inventer. Une donnée obligatoire
laissée à `null` reste une erreur permanente, vérifiée après l'appel
(processor.py), comme avant la cascade.

`ranking_name` reste du texte libre, sans enum : `canonical_ranking_name()` le
ramène sur les médias connus, et un média inconnu garde son écriture, ce que
l'enum `Autre` du pipeline ne ferait pas.
"""

from backend.ai.extraction_schemas import (
    ACCREDITATION_EXTRACTION_SCHEMA,
    PRICING_EXTRACTION_SCHEMA,
    SCHOOL_STATS_EXTRACTION_SCHEMA,
)

# ── Vérification de compatibilité ────────────────────────────────────

COMPATIBILITY_SCHEMA = {
    "type": "object",
    "properties": {
        "compatible": {
            "type": "boolean",
            "description": "true si la page contient des données exploitables pour les catégories demandées.",
        },
        "matched_categories": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Catégories pour lesquelles la page contient des données.",
        },
        "reason": {
            "type": "string",
            "description": "Une phrase : pourquoi la page est, ou n'est pas, exploitable.",
        },
    },
    "required": ["compatible"],
}

_SOURCE_URL = {"type": ["string", "null"], "description": "URL exacte de la page."}
_ACADEMIC_YEAR = {
    "type": ["integer", "null"],
    "description": "Année de début de l'année scolaire (2026 pour 2026-2027), null si absente.",
}
_RANKING_NAME = {
    "type": "string",
    "description": "Nom du média tel qu'il figure dans la page.",
}

# ── Mono-programme : un objet plat ───────────────────────────────────

RANKING_SCHEMA = {
    "type": "object",
    "properties": {
        "ranking_name": _RANKING_NAME,
        "rank": {"type": ["integer", "null"], "description": "Rang obtenu, entier, null si absent."},
        "academic_year": {
            "type": ["integer", "null"],
            "description": "Année du palmarès telle qu'annoncée par le média, null si absente.",
        },
        "source_url": _SOURCE_URL,
        "data_conflict_warning": {
            "type": "boolean",
            "description": "true si la page donne des classements contradictoires.",
        },
    },
    "required": ["ranking_name", "rank", "academic_year"],
}

CAPACITY_SCHEMA = {
    "type": "object",
    "properties": {
        "spots_available": {
            "type": ["integer", "null"],
            "description": "Nombre de places. 0 est une valeur valide ; null si absent.",
        },
        "academic_year": _ACADEMIC_YEAR,
        "source_url": _SOURCE_URL,
        "year_assumed": {"type": "boolean", "description": "true si l'année a été déduite et non lue."},
    },
    "required": ["spots_available", "academic_year"],
}

# ── Multi-programme : un objet par programme cité par la page ────────

_PROGRAM_NAME = {
    "type": "string",
    "description": "Nom exact du programme tel que trouvé dans la page.",
}


def _multi_program(item_properties: dict, extra_properties: dict) -> dict:
    return {
        "type": "object",
        "properties": {
            "programs": {
                "type": "array",
                "description": "Un objet par programme cité par la page.",
                "items": {
                    "type": "object",
                    "properties": {"program_name": _PROGRAM_NAME, **item_properties},
                    "required": ["program_name"],
                },
            },
            **extra_properties,
        },
        "required": ["programs"],
    }


_PRICING_ITEM = {
    key: PRICING_EXTRACTION_SCHEMA["properties"][key]
    for key in (
        "academic_year", "currency", "year_1_fee", "year_2_fee", "year_3_fee",
        "year_4_fee", "year_5_fee", "total_fee", "intl_year_1_fee", "intl_total_fee",
        "intl_currency", "additional_fees_notes", "source_url",
    )
}

PRICING_MULTI_SCHEMA = _multi_program(
    _PRICING_ITEM,
    {
        "year_assumed": PRICING_EXTRACTION_SCHEMA["properties"]["year_assumed"],
        "data_conflict_warning": PRICING_EXTRACTION_SCHEMA["properties"]["data_conflict_warning"],
    },
)

RANKING_MULTI_SCHEMA = _multi_program(
    {
        "ranking_name": _RANKING_NAME,
        "rank": RANKING_SCHEMA["properties"]["rank"],
        "academic_year": RANKING_SCHEMA["properties"]["academic_year"],
        "source_url": _SOURCE_URL,
    },
    {"data_conflict_warning": RANKING_SCHEMA["properties"]["data_conflict_warning"]},
)

CAPACITY_MULTI_SCHEMA = _multi_program(
    {
        "spots_available": CAPACITY_SCHEMA["properties"]["spots_available"],
        "academic_year": _ACADEMIC_YEAR,
        "source_url": _SOURCE_URL,
    },
    {"year_assumed": CAPACITY_SCHEMA["properties"]["year_assumed"]},
)

_SINGLE = {
    "Pricing": PRICING_EXTRACTION_SCHEMA,
    "Ranking": RANKING_SCHEMA,
    "Capacity": CAPACITY_SCHEMA,
    "SchoolStats": SCHOOL_STATS_EXTRACTION_SCHEMA,
    "Accreditation": ACCREDITATION_EXTRACTION_SCHEMA,
}

_MULTI = {
    "Pricing": PRICING_MULTI_SCHEMA,
    "Ranking": RANKING_MULTI_SCHEMA,
    "Capacity": CAPACITY_MULTI_SCHEMA,
}


def extraction_schema(category: str, multi_program: bool = False) -> dict:
    """
    Schéma d'extraction d'une contribution : le même objet à chaque appel.

    Raises:
        ValueError: catégorie inconnue, ou sans mode multi-programme.
    """
    table = _MULTI if multi_program else _SINGLE
    try:
        return table[category]
    except KeyError:
        mode = "multi-programme" if multi_program else "mono-programme"
        raise ValueError(f"Pas de schéma {mode} pour la catégorie {category}") from None
