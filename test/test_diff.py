"""
Le diff à la production (backend/pipeline/diff.py).

`has_data_changed` décide si une extraction mérite un ticket. Un faux
« inchangé » supprime la donnée sans trace : aucun ticket, rien dans l'inbox.
Un faux « changé » ne coûte qu'un ticket de trop. Les tests tiennent donc
surtout la première direction. Pour chaque catégorie comparée, avec les
colonnes que la Phase 2 lui passe (`DB_FIELDS_BY_CATEGORY`) : identique →
False, un champ changé → True, `None` contre `0`, aucune ligne en production
→ True. Plan backend-local, étape 7 (P0).

Ni base ni réseau : les lignes de production sont des dict, comme les rend
`RealDictCursor`.
"""

import pytest

from backend.pipeline.diff import has_data_changed
from backend.pipeline.phase2_research import DB_FIELDS_BY_CATEGORY


# Une extraction par catégorie, et la ligne de production identique : les
# colonnes de la table, plus ce que la table ne connaît pas (id, clés, dates).
CASES = {
    "Pricing": (
        {
            "academic_year": 2026, "currency": "EUR",
            "year_1_fee": 14500, "year_2_fee": 14500, "year_3_fee": 14500,
            "year_4_fee": None, "year_5_fee": None, "total_fee": 43500,
            "intl_year_1_fee": 16500, "intl_total_fee": 49500, "intl_currency": "EUR",
            "additional_fees_notes": "Frais de dossier : 120 €",
            "source_url": "https://www.em-normandie.com/fr/frais",
            "year_assumed": True, "data_conflict_warning": False,
        },
        {
            "id": "pricing-1", "programId": "program-1",
            "academic_year": 2026, "currency": "EUR",
            "year_1_fee": 14500.0, "year_2_fee": 14500.0, "year_3_fee": 14500.0,
            "year_4_fee": None, "year_5_fee": None, "total_fee": 43500.0,
            "intl_year_1_fee": 16500.0, "intl_total_fee": 49500.0, "intl_currency": "EUR",
            "additional_fees_notes": "Frais de dossier : 120 €",
            "source_url": "https://www.em-normandie.com/fr/autre-page",
        },
        "total_fee", 45000,
    ),
    "Ranking": (
        {
            "academic_year": 2026, "ranking_name": "Financial Times", "rank": 32,
            "scope": "program", "program_hint": "Master in Management",
            "ranking_label": "FT Masters in Management", "source_url": "https://rankings.ft.com",
        },
        {
            "id": "ranking-1", "programId": "program-1",
            "academic_year": 2026, "ranking_name": "Financial Times", "rank": 32,
            "source_url": None,
        },
        "rank", 29,
    ),
    "Capacity": (
        {"academic_year": 2026, "spots_available": 120, "admission_channel": "SESAME"},
        {"id": "cap-1", "programCampusId": "pc-1", "academic_year": 2026, "spots_available": 120},
        "spots_available", 140,
    ),
    "SchoolStats": (
        {
            "academic_year": 2026, "total_students": 6400, "total_alumni": 22000,
            "partner_companies": None, "annual_internship_offers": 4000,
            "abroad_campuses": 2, "partner_universities": 210,
            "permanent_professors": 160, "international_professors_pct": 47.5,
            "external_speakers_pct": None,
        },
        {
            "id": "stats-1", "schoolId": "school-1",
            "academic_year": 2026, "total_students": 6400, "total_alumni": 22000,
            "partner_companies": None, "annual_internship_offers": 4000,
            "abroad_campuses": 2, "partner_universities": 210,
            "permanent_professors": 160, "international_professors_pct": 47.5,
            "external_speakers_pct": None,
        },
        "international_professors_pct", 49.0,
    ),
}


def test_chaque_categorie_comparee_a_un_cas():
    assert set(CASES) == set(DB_FIELDS_BY_CATEGORY)


@pytest.mark.parametrize("category", sorted(CASES))
def test_identique_a_la_production_inchange(category):
    new, existing, _field, _value = CASES[category]
    assert has_data_changed(new, existing, DB_FIELDS_BY_CATEGORY[category]) is False


@pytest.mark.parametrize("category", sorted(CASES))
def test_un_champ_change_change(category):
    new, existing, field, value = CASES[category]
    assert has_data_changed({**new, field: value}, existing, DB_FIELDS_BY_CATEGORY[category]) is True


@pytest.mark.parametrize("category", sorted(CASES))
def test_aucune_ligne_en_production_change(category):
    new, _existing, _field, _value = CASES[category]
    assert has_data_changed(new, None, DB_FIELDS_BY_CATEGORY[category]) is True


@pytest.mark.parametrize("category", sorted(CASES))
def test_none_contre_zero_dans_les_deux_sens(category):
    """0 place, 0 € de frais : une valeur, pas une absence. Jamais « inchangé »."""
    new, existing, field, _value = CASES[category]
    fields = DB_FIELDS_BY_CATEGORY[category]

    assert has_data_changed({**new, field: None}, {**existing, field: 0}, fields) is True
    assert has_data_changed({**new, field: 0}, {**existing, field: None}, fields) is True
    assert has_data_changed({**new, field: 0}, {**existing, field: 0}, fields) is False


def test_l_annee_compte_meme_a_valeurs_egales():
    """Les frais 2027 identiques à ceux de 2026 sont une donnée nouvelle."""
    new, existing, _field, _value = CASES["Pricing"]
    assert has_data_changed({**new, "academic_year": 2027}, existing, DB_FIELDS_BY_CATEGORY["Pricing"]) is True


def test_les_champs_techniques_ne_comptent_pas():
    new = {"academic_year": 2026, "spots_available": 120,
           "source_url": "https://ailleurs.fr", "year_assumed": True, "data_conflict_warning": True}
    existing = {"academic_year": 2026, "spots_available": 120, "source_url": "https://ici.fr"}
    assert has_data_changed(new, existing) is False


def test_hors_colonnes_de_la_table_rien_n_est_compare():
    """Sans la liste des colonnes, le `scope` d'un classement face à un None
    systématique ferait conclure « changé » à chaque passage."""
    new, existing, _field, _value = CASES["Ranking"]
    assert has_data_changed(new, existing) is True
    assert has_data_changed(new, existing, DB_FIELDS_BY_CATEGORY["Ranking"]) is False


def test_entier_et_flottant_se_comparent_en_nombre():
    assert has_data_changed({"total_fee": 43500}, {"total_fee": 43500.0}) is False
    assert has_data_changed({"total_fee": 43500.5}, {"total_fee": 43500}) is True


def test_texte_compare_sans_casse_ni_espaces_de_bord():
    assert has_data_changed({"currency": " eur "}, {"currency": "EUR"}) is False
    assert has_data_changed({"ranking_name": "Le Figaro"}, {"ranking_name": "Les Echos"}) is True


def test_chaine_vide_contre_absence():
    """Une chaîne vide extraite ne vaut pas mieux qu'un NULL en base ; l'inverse
    (NULL extrait, texte en base) est un changement."""
    assert has_data_changed({"additional_fees_notes": ""}, {"additional_fees_notes": None}) is False
    assert has_data_changed({"additional_fees_notes": None}, {"additional_fees_notes": ""}) is True


def test_une_cle_absente_de_l_extraction_n_est_pas_comparee():
    assert has_data_changed({"academic_year": 2026}, {"academic_year": 2026, "total_fee": 43500}) is False


def test_listes_dans_un_autre_ordre():
    """Deux listes de même contenu dans un autre ordre se lisent « changé ».

    C'est la direction sûre (un ticket de trop, jamais un faux « inchangé »).
    Aucune colonne comparée n'est une liste aujourd'hui
    (`DB_FIELDS_BY_CATEGORY`) : le cas ne naît que d'un appel sans liste de
    colonnes, et Accreditation, la seule catégorie appelée ainsi, n'a jamais de
    ligne de production à comparer (`_get_existing_record` rend None).
    """
    assert has_data_changed({"languages": ["EN", "FR"]}, {"languages": ["FR", "EN"]}) is True
    assert has_data_changed({"languages": ["FR", "EN"]}, {"languages": ["FR", "EN"]}) is False
    assert all(
        not isinstance(value, list)
        for new, existing, _f, _v in CASES.values()
        for value in [*new.values(), *existing.values()]
    )
