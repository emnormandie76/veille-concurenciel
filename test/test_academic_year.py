"""
L'année scolaire cible (backend/utils/academic_year.py).

Toutes les recherches visent la prochaine rentrée : une erreur d'un an fait
payer un rapport sur une année déjà publiée, ou pas encore. Plan
backend-local, étape 7 (P1) : bornes du 31 août et du 1er septembre, pour
l'année cible et l'année courante.
"""

from datetime import date

import pytest

from backend.utils import academic_year


@pytest.fixture
def today(monkeypatch):
    def set_today(value: date):
        class FixedDate(date):
            @classmethod
            def today(cls):
                return value

        monkeypatch.setattr(academic_year, "date", FixedDate)
    return set_today


@pytest.mark.parametrize("day, target, current", [
    (date(2026, 1, 1), 2026, 2025),
    (date(2026, 5, 15), 2026, 2025),
    (date(2026, 8, 31), 2026, 2025),   # dernier jour de 2025-2026
    (date(2026, 9, 1), 2027, 2026),    # premier jour de 2026-2027
    (date(2026, 10, 14), 2027, 2026),
    (date(2026, 12, 31), 2027, 2026),
])
def test_bornes_du_31_aout_et_du_1er_septembre(today, day, target, current):
    today(day)

    assert academic_year.get_target_academic_year_int() == target
    assert academic_year.get_target_academic_year_str() == f"{target}-{target + 1}"
    assert academic_year.get_current_academic_year_int() == current
    # La cible est toujours l'année qui suit l'année en cours.
    assert target == current + 1


@pytest.mark.parametrize("day, period_start", [
    (date(2026, 8, 31), date(2025, 9, 1)),
    (date(2026, 9, 1), date(2026, 9, 1)),
    (date(2026, 9, 29), date(2026, 9, 1)),
])
def test_debut_de_la_periode_de_l_annee_cible(today, day, period_start):
    today(day)
    assert academic_year.get_target_period_start() == period_start
