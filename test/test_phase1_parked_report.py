"""
Un rapport Research n'est payé qu'une fois.

Le 2026-09-28, deux découvertes de Phase 1 ont échoué sur des 503 Gemini et
leurs rapports Research (~25 crédits chacun) sont partis avec l'échec. Ces tests
tiennent la correction : une extraction échouée range le rapport dans un ticket
`Failed`, la passe suivante le reprend sans rappeler Research, et une extraction
réussie le consomme. Voir `_load_parked_report()` dans
backend/pipeline/phase1_research.py.
"""

import json
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from backend.ai.gemini_client import GeminiError
from backend.pipeline import phase1_research

SCHOOL = {"id": "s1", "name": "EMLV", "official_domain": "emlv.fr", "status": "ACTIVE"}
REPORT = "## EMLV\nCampus de Paris La Défense : Bachelor, PGE..."
SOURCES = [{"url": "https://www.emlv.fr/programmes"}]
EXTRACTED = {
    "discovered_campuses": [
        {"name": "Paris La Défense", "city": "Paris", "programs": [{"name": "Programme Grande École"}]}
    ]
}


class FakeDB:
    """Une base réduite aux requêtes que la découverte émet."""

    def __init__(self, parked: dict | None = None):
        self.parked = parked
        self.statements: list[tuple[str, tuple]] = []

    @contextmanager
    def connection(self):
        yield self

    def cursor(self, cursor_factory=None):
        db = self

        class Cursor:
            _row = None

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(self, sql, params=()):
                db.statements.append((" ".join(sql.split()), tuple(params)))
                if 'FROM "School"' in sql:
                    self._row = SCHOOL
                elif "parked_reason" in sql and sql.lstrip().upper().startswith("SELECT"):
                    self._row = db.parked
                else:
                    self._row = None

            def fetchone(self):
                return self._row

        return Cursor()

    def sql(self, keyword: str) -> list[tuple[str, tuple]]:
        return [(s, p) for s, p in self.statements if s.upper().startswith(keyword)]


def _run(db: FakeDB, extraction):
    """Une découverte réelle, base et appels payants remplacés."""
    research = patch.object(
        phase1_research, "create_research_task",
        return_value={"report": REPORT, "sources": SOURCES},
    )
    extract = patch.object(
        phase1_research, "extract_structured",
        **({"side_effect": extraction} if isinstance(extraction, Exception) else {"return_value": extraction}),
    )
    with patch("backend.db.get_db_connection", db.connection), \
            patch.object(phase1_research, "fetch_catalog", return_value=None), \
            research as research_mock, extract as extract_mock:
        result = phase1_research.run_phase1_research("s1", "key-manager")
    return result, research_mock, extract_mock


def _parked_row(**overrides) -> dict:
    row = {
        "id": "parked-1",
        "raw_report": REPORT,
        "urls": ["https://www.emlv.fr/programmes"],
        "createdAt": datetime(2026, 9, 28, 10, 52, tzinfo=timezone.utc),
    }
    row.update(overrides)
    return row


def test_une_extraction_echouee_range_le_rapport():
    db = FakeDB()
    result, research, _ = _run(db, GeminiError("503 high demand"))

    assert result["success"] is False
    assert research.call_count == 1
    inserts = db.sql("INSERT")
    assert len(inserts) == 1, "le rapport doit être rangé, une fois"
    sql, params = inserts[0]
    assert '"ContributionInbox"' in sql
    ticket_id, school_id, category, payload, status, urls, _created, raw = params
    assert (school_id, category, status) == ("s1", "Program_Discovery", "Failed")
    assert raw == REPORT
    assert urls == ["https://www.emlv.fr/programmes"]
    assert json.loads(payload)["parked_reason"] == phase1_research.PARKED_REPORT_REASON
    assert result["parked_report_ticket_id"] == ticket_id
    assert result["research_report_reused"] is False


def test_la_passe_suivante_reprend_le_rapport_sans_rappeler_research():
    db = FakeDB(parked=_parked_row())
    result, research, extract = _run(db, EXTRACTED)

    assert research.call_count == 0, "Research ne doit pas être repayé"
    assert extract.call_args.kwargs["source_text"] == REPORT
    assert result["success"] is True
    assert result["research_report_reused"] is True


def test_une_extraction_reussie_consomme_le_rapport_range():
    db = FakeDB(parked=_parked_row())
    _run(db, EXTRACTED)

    deletes = db.sql("DELETE")
    assert deletes == [
        ('DELETE FROM "ContributionInbox" WHERE id = %s AND status = %s', ("parked-1", "Failed"))
    ]
    pending = [p for s, p in db.sql("INSERT") if "'Pending_Admin'" in s]
    assert len(pending) == 1 and pending[0][-1] == REPORT, "le nouveau ticket porte le même rapport"


def test_un_nouvel_echec_sur_un_rapport_repris_ne_le_duplique_pas():
    db = FakeDB(parked=_parked_row())
    result, research, _ = _run(db, GeminiError("503 encore"))

    assert research.call_count == 0
    assert db.sql("INSERT") == [], "aucun second ticket rangé"
    updates = db.sql("UPDATE")
    assert len(updates) == 1 and updates[0][1][-1] == "parked-1"
    assert result["parked_report_ticket_id"] == "parked-1"
    assert result["research_report_reused"] is True


def test_la_recherche_ne_cible_que_les_rapports_ranges_recents_de_lecole():
    db = FakeDB()
    _run(db, EXTRACTED)

    lookup = [(s, p) for s, p in db.sql("SELECT") if "parked_reason" in s]
    assert len(lookup) == 1
    sql, params = lookup[0]
    assert params == (
        "s1", "Program_Discovery", "Failed",
        phase1_research.PARKED_REPORT_REASON, phase1_research.PARKED_REPORT_MAX_AGE_DAYS,
    )
    assert "source_type = 'Automated_AI'" in sql


def test_une_panne_de_lecture_paie_research_comme_avant():
    """Le rangement est un gain, jamais une nouvelle cause d'échec."""
    db = FakeDB()

    @contextmanager
    def broken_then_ok():
        broken_then_ok.calls += 1
        if broken_then_ok.calls == 2:  # 1 = l'école, 2 = la recherche du rapport rangé
            raise RuntimeError("base injoignable")
        yield db
    broken_then_ok.calls = 0

    with patch("backend.db.get_db_connection", broken_then_ok), \
            patch.object(phase1_research, "fetch_catalog", return_value=None), \
            patch.object(phase1_research, "create_research_task",
                         return_value={"report": REPORT, "sources": SOURCES}) as research, \
            patch.object(phase1_research, "extract_structured", return_value=EXTRACTED):
        result = phase1_research.run_phase1_research("s1", "key-manager")

    assert research.call_count == 1
    assert result["success"] is True


def test_le_dry_run_ne_lit_ni_ne_range_rien():
    db = FakeDB(parked=_parked_row())
    with patch("backend.db.get_db_connection", db.connection), \
            patch.object(phase1_research, "create_research_task",
                         return_value={"report": REPORT, "sources": SOURCES}):
        result = phase1_research.run_phase1_research("s1", "key-manager", dry_run=True)

    assert result["success"] is True
    assert not [s for s, _ in db.statements if "parked_reason" in s]
    assert db.sql("INSERT") == [] and db.sql("DELETE") == []


@pytest.mark.parametrize("extraction", [["pas un objet"], GeminiError("x")])
def test_toute_forme_dechec_dextraction_range_le_rapport(extraction):
    db = FakeDB()
    result, _, _ = _run(db, extraction)
    assert result["success"] is False
    assert len(db.sql("INSERT")) == 1
