"""
Les contrats de la couche d'extraction et des briefs Research.

- backend/ai/extraction_schemas.py, extraction_prompts.py : chaque catégorie
  de backend/constants.py a un schéma et un prompt (`get_extraction_*` ne lève
  pas), `MIN_TIER_BY_CATEGORY` les couvre toutes, et chaque schéma est un objet
  JSON Schema bien formé (`type`, `properties`, `required` ⊂ `properties`) ;
- backend/ai/research_prompts.py : chaque brief nomme l'école et son domaine,
  les briefs datés portent l'année cible, et aucun ne reçoit de texte
  d'utilisateur.

Plan backend-local, étape 7 (P1). Écart au plan : la Phase 1 (inventaire,
brief gardé inchangé par choix, voir l'en-tête de research_prompts.py) et
Accreditation (validité actuelle) n'ont pas d'année par construction ; seuls
les quatre briefs datés sont tenus de la porter.
"""

import inspect
from pathlib import Path

import pytest

from backend import constants
from backend.ai import research_prompts
from backend.ai.extraction_prompts import (
    EXTRACTION_PROMPTS,
    get_extraction_prompt,
    ranking_extraction_prompt,
    with_catalog_anchor,
)
from backend.ai.extraction_schemas import (
    ARRAY_RESULT_KEYS,
    CATALOG_EXTRACTION_SCHEMA,
    EXTRACTION_SCHEMAS,
    MIN_TIER_BY_CATEGORY,
    get_extraction_schema,
    get_min_tier,
    ranking_extraction_schema,
)

ROOT = Path(__file__).resolve().parent.parent
JSON_TYPES = {"object", "array", "string", "integer", "number", "boolean", "null"}
TIERS = {"low", "mid", "high"}


# ── Une entrée par catégorie ─────────────────────────────────────────

@pytest.mark.parametrize("category", constants.CONTRIBUTION_CATEGORIES)
def test_chaque_categorie_a_un_schema_un_prompt_et_un_plancher(category):
    assert isinstance(get_extraction_schema(category), dict)
    assert get_extraction_prompt(category).strip()
    assert MIN_TIER_BY_CATEGORY[category] in TIERS
    assert get_min_tier(category) == MIN_TIER_BY_CATEGORY[category]


def test_les_trois_registres_couvrent_les_memes_categories():
    assert set(EXTRACTION_SCHEMAS) == set(EXTRACTION_PROMPTS) == set(MIN_TIER_BY_CATEGORY)
    assert set(constants.CONTRIBUTION_CATEGORIES) <= set(EXTRACTION_SCHEMAS)


def test_une_categorie_inconnue_leve_une_erreur_explicite():
    with pytest.raises(ValueError, match="Catégorie inconnue"):
        get_extraction_schema("Salaires")
    with pytest.raises(ValueError, match="Catégorie inconnue"):
        get_extraction_prompt("Salaires")


def test_les_categories_a_tableau_rendent_bien_un_tableau():
    for category, key in ARRAY_RESULT_KEYS.items():
        schema = get_extraction_schema(category)
        assert schema["properties"][key]["type"] == "array", category


# ── Schémas bien formés ──────────────────────────────────────────────

def _types(node) -> set[str]:
    declared = node.get("type")
    return set(declared) if isinstance(declared, list) else {declared}


def _check(node, path):
    """Parcourt un schéma ; rend la liste des défauts de forme."""
    problems = []
    if not isinstance(node, dict):
        return [f"{path} : un dict attendu"]
    if "type" not in node and "enum" not in node:
        return [f"{path} : ni type ni enum"]
    if "type" in node and not _types(node) <= JSON_TYPES:
        problems.append(f"{path} : type inconnu {node['type']}")
    if "object" in _types(node):
        properties = node.get("properties")
        if not isinstance(properties, dict) or not properties:
            problems.append(f"{path} : objet sans properties")
            properties = {}
        required = node.get("required", [])
        if not set(required) <= set(properties):
            problems.append(f"{path} : required hors properties {set(required) - set(properties)}")
        for name, child in properties.items():
            problems += _check(child, f"{path}.{name}")
    if "array" in _types(node):
        if "items" not in node:
            problems.append(f"{path} : tableau sans items")
        else:
            problems += _check(node["items"], f"{path}[]")
    return problems


SCHEMAS = {
    **EXTRACTION_SCHEMAS,
    "Catalog": CATALOG_EXTRACTION_SCHEMA,
    "Ranking (fermé sur les programmes)": ranking_extraction_schema(["PGE", "Bachelor"]),
}


@pytest.mark.parametrize("name", sorted(SCHEMAS))
def test_chaque_schema_est_un_objet_json_schema_bien_forme(name):
    schema = SCHEMAS[name]
    assert schema["type"] == "object"
    assert _check(schema, name) == []


def test_le_controle_de_forme_repere_les_defauts():
    """Contrôle positif : sans lui, un _check trop indulgent passerait tout."""
    assert _check({"type": "object", "properties": {"a": {"type": "string"}}, "required": ["b"]}, "x")
    assert _check({"type": "array"}, "x")
    assert _check({"type": "objet"}, "x")
    assert _check({"type": "object"}, "x")


# ── Prompts ──────────────────────────────────────────────────────────

def test_l_ancrage_catalogue_est_un_bonus_jamais_une_dependance():
    prompt = get_extraction_prompt("Program_Discovery")
    assert with_catalog_anchor(prompt, None) == prompt
    assert with_catalog_anchor(prompt, []) == prompt
    anchored = with_catalog_anchor(prompt, ["Programme Grande École", "Bachelor Management"])
    assert anchored.startswith(prompt)
    assert "- Programme Grande École" in anchored


def test_le_prompt_ranking_generique_sans_programme():
    assert ranking_extraction_prompt([]) == get_extraction_prompt("Ranking")
    assert ranking_extraction_prompt(["", None]) == get_extraction_prompt("Ranking")


# ── Briefs Research ──────────────────────────────────────────────────

SCHOOL = "EM Normandie"
DOMAIN = "em-normandie.com"
YEAR = "2027-2028"

DATED_BRIEFS = {
    "Pricing": lambda: research_prompts.build_pricing_research_input(SCHOOL, "Programme Grande École", YEAR, DOMAIN),
    "Ranking": lambda: research_prompts.build_ranking_research_input(SCHOOL, ["Programme Grande École"], YEAR, DOMAIN),
    "Capacity": lambda: research_prompts.build_capacity_research_input(SCHOOL, "Caen", "Bachelor", YEAR, DOMAIN),
    "SchoolStats": lambda: research_prompts.build_school_stats_research_input(SCHOOL, YEAR, DOMAIN),
}
UNDATED_BRIEFS = {
    "Program_Discovery": lambda: research_prompts.build_phase1_research_input(SCHOOL, DOMAIN),
    "Accreditation": lambda: research_prompts.build_accreditation_research_input(SCHOOL, DOMAIN),
}


@pytest.mark.parametrize("category", sorted({**DATED_BRIEFS, **UNDATED_BRIEFS}))
def test_chaque_brief_nomme_l_ecole_et_son_domaine(category):
    brief = {**DATED_BRIEFS, **UNDATED_BRIEFS}[category]()
    assert SCHOOL in brief
    assert DOMAIN in brief


@pytest.mark.parametrize("category", sorted(DATED_BRIEFS))
def test_les_briefs_dates_portent_l_annee_cible(category):
    assert YEAR in DATED_BRIEFS[category]()


def test_les_briefs_couvrent_les_six_categories():
    assert set(DATED_BRIEFS) | set(UNDATED_BRIEFS) == set(constants.CONTRIBUTION_CATEGORIES)


def test_aucun_brief_ne_recoit_de_texte_d_utilisateur():
    """`user_text` n'atteint jamais un modèle (architecture.md §10.1 c)."""
    allowed = {"school_name", "domain", "program_name", "program_names", "campus_name", "academic_year_str"}
    builders = [
        member for name, member in inspect.getmembers(research_prompts, inspect.isfunction)
        if name.startswith("build_")
    ]
    assert len(builders) == 6
    for builder in builders:
        assert set(inspect.signature(builder).parameters) <= allowed, builder.__name__

    # Ni les briefs, ni les deux phases qui les appellent ne lisent user_text.
    for relative in ("backend/ai/research_prompts.py", "backend/pipeline/phase1_research.py",
                     "backend/pipeline/phase2_research.py"):
        assert "user_text" not in (ROOT / relative).read_text(encoding="utf-8"), relative
