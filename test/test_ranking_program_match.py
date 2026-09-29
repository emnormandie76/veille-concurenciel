"""
Rattachement des classements aux programmes, et noms de médias.

Deux défauts corrigés ensemble :
  - la Phase 2 rattachait un classement à un programme par inclusion de
    sous-chaîne : « Bachelor Management, Data et IA Responsables » tombait sur
    le « Bachelor Management », et « Bachelor en Management » ne tombait nulle
    part ;
  - le crowdsourcing écrivait le nom du média en texte libre : « Le Figaro »
    d'un côté, « Le Figaro Étudiant » de l'autre, deux lignes pour un palmarès.

Les noms de programmes sont ceux d'EM Normandie en base, recopiés tels quels.
"""

from backend.ai.extraction_prompts import RANKING_EXTRACTION_PROMPT, ranking_extraction_prompt
from backend.ai.extraction_schemas import (
    NO_PROGRAM_HINT,
    RANKING_EXTRACTION_SCHEMA,
    RANKING_NAME_ENUM,
    canonical_ranking_name,
    ranking_extraction_schema,
)
from backend.pipeline.phase2_research import _match_program

_EN_PROGRAMS = [
    {"id": "p1", "name": "Bachelor Management"},
    {"id": "p2", "name": "Bachelor Management International"},
    {"id": "p3", "name": "International Bachelor in Business Administration"},
    {"id": "p4", "name": "Master of Science (MSc) - Banking, Finance and FinTech"},
    {"id": "p5", "name": "Programme Grande École"},
]
_NAMES = [p["name"] for p in _EN_PROGRAMS]


def _hint(item_schema_owner: dict) -> dict:
    return item_schema_owner["properties"]["rankings"]["items"]["properties"]["program_hint"]


# --- Phase 2 : le rattachement ------------------------------------------------

def test_le_nom_choisi_dans_la_liste_est_rattache_tel_quel():
    for program in _EN_PROGRAMS:
        assert _match_program(program["name"], _EN_PROGRAMS) is program


def test_les_ecritures_du_site_restent_reconnues():
    for hint, expected in [
        ("Bachelor en Management", "Bachelor Management"),
        ("Programme Grande Ecole en 5 ans", "Programme Grande École"),
        ("IBBA (International Bachelor in Business Administration)",
         "International Bachelor in Business Administration"),
        ("MSc Banking, Finance and FinTech",
         "Master of Science (MSc) - Banking, Finance and FinTech"),
    ]:
        assert _match_program(hint, _EN_PROGRAMS)["name"] == expected, hint


def test_un_autre_diplome_n_est_plus_colle_par_inclusion():
    """L'inclusion de sous-chaîne rattachait ces deux-là au Bachelor Management."""
    for hint in (
        "Bachelor Management, Data et IA Responsables",
        "Doctorate in Business Administration",
    ):
        assert _match_program(hint, _EN_PROGRAMS) is None, hint


def test_la_sentinelle_et_le_vide_ne_rattachent_rien():
    assert _match_program(NO_PROGRAM_HINT, _EN_PROGRAMS) is None
    assert _match_program(None, _EN_PROGRAMS) is None
    assert _match_program("", _EN_PROGRAMS) is None


def test_deux_programmes_qui_repondent_n_en_rattachent_aucun():
    ambigus = [
        {"id": "a", "name": "Programme Grande École"},
        {"id": "b", "name": "Programme Grande Ecole"},
    ]
    assert _match_program("Programme Grande École en 5 ans", ambigus) is None


# --- Phase 2 : l'extraction reçoit la liste ------------------------------------

def test_le_schema_ferme_program_hint_sur_les_programmes_de_l_ecole():
    schema = ranking_extraction_schema(_NAMES + ["Programme Grande École"])
    hint = _hint(schema)
    assert hint["type"] == "string"
    assert hint["enum"] == _NAMES + [NO_PROGRAM_HINT]


def test_le_schema_generique_n_est_pas_modifie():
    before = _hint(RANKING_EXTRACTION_SCHEMA)
    ranking_extraction_schema(_NAMES)
    assert _hint(RANKING_EXTRACTION_SCHEMA) is before
    assert "enum" not in before
    assert ranking_extraction_schema([]) is RANKING_EXTRACTION_SCHEMA


def test_le_prompt_liste_les_programmes_et_la_sentinelle():
    prompt = ranking_extraction_prompt(_NAMES)
    assert prompt.startswith(RANKING_EXTRACTION_PROMPT)
    for name in _NAMES:
        assert f"- {name}" in prompt
    assert NO_PROGRAM_HINT in prompt
    assert ranking_extraction_prompt([]) == RANKING_EXTRACTION_PROMPT


# --- Crowdsourcing : le nom du média -------------------------------------------

def test_les_ecritures_courantes_reviennent_sur_la_liste_du_pipeline():
    for raw, expected in [
        ("Le Figaro", "Le Figaro Étudiant"),
        ("Figaro Etudiant", "Le Figaro Étudiant"),
        ("Le Parisien Etudiant", "Le Parisien Étudiant"),
        ("L'Etudiant", "L'Étudiant"),
        ("L’Étudiant — classement des écoles post-bac", "L'Étudiant"),
        ("letudiant.fr", "L'Étudiant"),
        ("Le Point", "Le Point"),
        ("CHALLENGES", "Challenges"),
        ("QS World University Rankings", "QS"),
        ("Financial Times Masters in Management", "Financial Times"),
        ("FT European Business Schools", "Financial Times"),
        ("Classement SIGEM", "SIGEM"),
    ]:
        assert canonical_ranking_name(raw) == expected, raw


def test_la_liste_du_pipeline_est_stable():
    for name in RANKING_NAME_ENUM:
        if name != "Autre":
            assert canonical_ranking_name(name) == name


def test_un_autre_media_est_garde_tel_quel():
    assert canonical_ranking_name("  Times Higher Education ") == "Times Higher Education"
    assert canonical_ranking_name("Eduniversal") == "Eduniversal"
    assert canonical_ranking_name(None) is None
    assert canonical_ranking_name("") == ""


def test_les_prompts_du_crowdsourcing_donnent_la_liste():
    from backend.crowdsourcing.processor import RANKING_MULTI_PROGRAM_PROMPT, RANKING_SYSTEM_PROMPT

    multi = RANKING_MULTI_PROGRAM_PROMPT.format(known_programs="- Programme Grande École")
    for prompt in (RANKING_SYSTEM_PROMPT, multi):
        assert "Le Figaro Étudiant" in prompt
        assert "(ex: Le Figaro" not in prompt
