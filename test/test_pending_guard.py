"""
Ne pas relancer ce qui attend déjà l'admin.

`has_data_changed` ne compare qu'à la production : un ticket que l'admin n'a pas
encore validé était repayé et recréé à chaque passe automatique. Ces tests
tiennent la garde : en passe automatique (`skip_pending=True`), aucune recherche
n'est lancée pour une cible dont un ticket du pipeline attend la validation
depuis le début de la période cible. Le chemin manuel ne change pas.
Voir backend/pipeline/pending_guard.py et docs/features/cron-rotation-production.md,
étape 1.

Les noms sont ceux d'Em Normandie en base.
"""

from contextlib import contextmanager
from datetime import date, datetime
from unittest.mock import patch

import pytest

from backend.ai.extraction_schemas import ranking_extraction_schema
from backend.constants import SOURCE_AUTOMATED_AI, STATUS_PENDING_ADMIN
from backend.pipeline import phase2_research
from backend.pipeline.pending_guard import read_pending_targets
from backend.utils import academic_year

PERIOD_START = date(2026, 9, 1)

SCHOOL = {"id": "s1", "name": "Em Normandie", "official_domain": "em-normandie.com", "status": "ACTIVE"}
PROGRAMS = [
    {"id": "p1", "name": "Bachelor Management", "schoolId": "s1"},
    {"id": "p2", "name": "International Bachelor in Business Administration", "schoolId": "s1"},
    {"id": "p3", "name": "Programme Grande École", "schoolId": "s1"},
]
PROGRAM_NAMES = [p["name"] for p in PROGRAMS]
PROGRAM_CAMPUSES = [
    {"program_campus_id": "pc1", "program_id": "p1", "campus_id": "c1",
     "program_name": "Bachelor Management", "campus_name": "Caen"},
    {"program_campus_id": "pc2", "program_id": "p2", "campus_id": "c1",
     "program_name": "International Bachelor in Business Administration", "campus_name": "Caen"},
    {"program_campus_id": "pc3", "program_id": "p3", "campus_id": "c2",
     "program_name": "Programme Grande École", "campus_name": "Le Havre"},
]


def _pending(category, *, program_id=None, program_campus_id=None,
             created=datetime(2026, 9, 15, 8, 0), is_discovery=False) -> dict:
    return {
        "ai_category": category,
        "programId": program_id,
        "programCampusId": program_campus_id,
        "createdAt": created,
        "is_discovery": is_discovery,
    }


class FakeCursor:
    def __init__(self, rows_for):
        self.rows_for = rows_for
        self.statements: list[tuple[str, tuple]] = []
        self._rows: list[dict] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        sql = " ".join(sql.split())
        self.statements.append((sql, tuple(params)))
        self._rows = self.rows_for(sql)

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)


class FakeDB:
    """Une base réduite aux lectures que la Phase 2 émet avant ses recherches."""

    def __init__(self, pending_rows: list[dict]):
        self.pending_rows = pending_rows
        self.statements: list[tuple[str, tuple]] = []

    @contextmanager
    def connection(self):
        yield self

    def cursor(self, cursor_factory=None):
        cursor = FakeCursor(self._rows_for)
        cursor.statements = self.statements
        return cursor

    def _rows_for(self, sql: str) -> list[dict]:
        if 'FROM "School"' in sql:
            return [SCHOOL]
        if 'FROM "ProgramCampus"' in sql:
            return PROGRAM_CAMPUSES
        if 'FROM "Program"' in sql:
            return PROGRAMS
        if 'FROM "ContributionInbox"' in sql:
            return self.pending_rows
        return []


def _run(db: FakeDB, *, skip_pending: bool, ranking_extraction: dict | None = None):
    """
    Une Phase 2 réelle, base et appels payants remplacés.

    `_run_research_and_extract` est le seul chemin vers Research : chaque appel
    qu'il reçoit est un appel payé. Sauf Ranking quand on le demande, il rend
    « rien de neuf » : une extraction réussie que `has_data_changed` juge
    identique à la production, ce qui n'écrit aucun ticket. (« Rien
    d'extrait » est désormais un échec de la cible, qui ferait échouer la
    passe : test_phase2_outcomes.py.)
    """
    calls: list[dict] = []

    def research(**kwargs):
        calls.append(kwargs)
        if kwargs["category"] == "Ranking" and ranking_extraction is not None:
            return phase2_research.ResearchOutcome(
                ranking_extraction, "## Classements", [], phase2_research.OUTCOME_OK,
            )
        return phase2_research.ResearchOutcome({}, "", [], phase2_research.OUTCOME_OK)

    with patch("backend.db.get_db_connection", db.connection), \
            patch.object(phase2_research, "get_target_period_start", return_value=PERIOD_START), \
            patch.object(phase2_research, "_run_research_and_extract", side_effect=research), \
            patch.object(phase2_research, "has_data_changed", return_value=False), \
            patch.object(phase2_research, "_write_ranking_tickets", return_value=(0, 0)) as write_ranking, \
            patch.object(phase2_research, "build_ranking_research_input",
                         wraps=phase2_research.build_ranking_research_input) as ranking_brief:
        result = phase2_research.run_phase2_research("s1", "key-manager", skip_pending=skip_pending)
    return result, calls, write_ranking, ranking_brief


def _researched(calls: list[dict]) -> list[tuple[str, str]]:
    return [(c["category"], c["label"]) for c in calls]


@pytest.fixture(autouse=True)
def _sans_limite_de_programmes(monkeypatch):
    monkeypatch.delenv("PHASE2_MAX_PROGRAMS", raising=False)


# --- Période cible -----------------------------------------------------------

@pytest.mark.parametrize("today, expected", [
    (date(2026, 9, 29), date(2026, 9, 1)),
    (date(2026, 5, 15), date(2025, 9, 1)),
    (date(2026, 8, 31), date(2025, 9, 1)),
])
def test_la_periode_cible_s_ouvre_le_1er_septembre(today, expected):
    class Today(date):
        @classmethod
        def today(cls):
            return today

    with patch.object(academic_year, "date", Today):
        assert academic_year.get_target_period_start() == expected


# --- La lecture ----------------------------------------------------------------

def test_la_requete_ne_lit_que_les_tickets_du_pipeline_en_attente_de_l_ecole():
    cur = FakeCursor(lambda sql: [])
    read_pending_targets(cur, "s1", PERIOD_START)

    [(sql, params)] = cur.statements
    assert params == ("s1", STATUS_PENDING_ADMIN, SOURCE_AUTOMATED_AI)
    assert '"schoolId" = %s' in sql
    assert "status = %s" in sql
    assert "source_type = %s" in sql
    assert "ai_extracted_json ? 'discovered_campuses'" in sql


def test_la_periode_borne_la_phase_2_mais_pas_la_decouverte():
    rows = [
        _pending("Pricing", program_id="p1"),
        _pending("Pricing", program_id="p2", created=datetime(2026, 8, 31, 23, 0)),
        _pending("Capacity", program_id="p3", program_campus_id="pc3", created=datetime(2026, 9, 1, 0, 0)),
        _pending("Capacity", program_id="p1"),  # sans couple : ne vise rien
        _pending("Ranking", program_id="p3"),
        _pending("SchoolStats", created=datetime(2026, 6, 1, 12, 0)),
        _pending("Program_Discovery", created=datetime(2025, 11, 3, 9, 0), is_discovery=True),
    ]
    targets = read_pending_targets(FakeCursor(lambda sql: rows), "s1", PERIOD_START)

    assert targets.pricing_program_ids == {"p1"}
    assert targets.capacity_program_campus_ids == {"pc3"}
    assert targets.school_categories == {"Ranking"}, "SchoolStats de juin visait l'année précédente"
    assert targets.discovery_pending is True, "une découverte n'a pas d'année"


def test_un_ticket_de_rattachement_campus_n_est_pas_une_decouverte_en_attente():
    rows = [_pending("Program_Discovery", is_discovery=False)]
    targets = read_pending_targets(FakeCursor(lambda sql: rows), "s1", PERIOD_START)

    assert targets.discovery_pending is False
    assert targets.school_categories == set()


# --- La Phase 2 automatique --------------------------------------------------

PENDING_ROWS = [
    _pending("Ranking", program_id="p3"),
    _pending("Pricing", program_id="p1"),
    _pending("Capacity", program_id="p2", program_campus_id="pc2"),
    _pending("SchoolStats", created=datetime(2026, 5, 20, 10, 0)),  # année précédente
]


def test_la_passe_automatique_ne_paie_aucune_cible_en_attente():
    db = FakeDB(PENDING_ROWS)
    result, calls, _, _ = _run(db, skip_pending=True)

    assert sorted(_researched(calls)) == sorted([
        ("SchoolStats", "pour Em Normandie"),
        ("Accreditation", "pour Em Normandie"),
        ("Pricing", "pour International Bachelor in Business Administration"),
        ("Pricing", "pour Programme Grande École"),
        ("Capacity", "pour Bachelor Management @ Caen"),
        ("Capacity", "pour Programme Grande École @ Le Havre"),
    ])
    assert result["success"] is True
    assert result["skipped_pending"] == {"school_categories": ["Ranking"], "pricing": 1, "capacity": 1}
    assert result["message"].endswith("sur 6 scans")


def test_ranking_recoit_tous_les_programmes_meme_bloques_en_pricing():
    db = FakeDB([_pending("Pricing", program_id="p1"), _pending("Pricing", program_id="p2")])
    rankings = {"rankings": [{"program_hint": "Bachelor Management", "ranking_name": "Le Figaro"}]}
    _, calls, write_ranking, ranking_brief = _run(db, skip_pending=True, ranking_extraction=rankings)

    assert [label for cat, label in _researched(calls) if cat == "Pricing"] == ["pour Programme Grande École"]
    assert ranking_brief.call_args.args[1] == PROGRAM_NAMES
    [ranking_call] = [c for c in calls if c["category"] == "Ranking"]
    assert ranking_call["extraction_schema"] == ranking_extraction_schema(PROGRAM_NAMES)
    assert write_ranking.call_args.kwargs["programs"] == PROGRAMS


def test_la_passe_manuelle_ne_change_pas():
    db = FakeDB(PENDING_ROWS)
    result, calls, _, _ = _run(db, skip_pending=False)

    assert not [s for s, _ in db.statements if '"ContributionInbox"' in s], "aucune lecture de l'Inbox"
    assert len(calls) == 3 + len(PROGRAMS) + len(PROGRAM_CAMPUSES)
    assert "skipped_pending" not in result
