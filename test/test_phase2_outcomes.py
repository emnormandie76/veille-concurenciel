"""
Une Phase 2 qui dit la vérité (défaut F1, règle D2).

Un appel Research ou une extraction qui échouait rendait `None`, et la boucle
passait à la cible suivante : en fin de passe, le résultat valait toujours
`success: True`. Une Phase 2 dont toutes les cibles avaient échoué (Gemini
saturé, panne Tavily hors quota) finissait `completed`, et l'école n'était pas
reprise avant 182 jours. Ces tests tiennent :
- le motif de chaque cible : `ok`, `research_failed`, `empty_report`,
  `extraction_unavailable`, `extraction_failed`, `bad_shape` (et `dry_run`) ;
- `outcomes` (les motifs par catégorie), `unchanged` (les enregistrements
  identiques à la production) et `failed_targets` ;
- D2 : `success: False` dès qu'une cible a échoué en recherche ou en
  extraction ;
- les déclencheurs : chacun clôt `failed` une Phase 2 qui rend `success: False`,
  et garde son résultat.

La vraie `run_phase2_research` tourne, avec le vrai `_run_research_and_extract` ;
Research (`create_research_task`), Gemini (`extract_structured`) et la base sont
des doubles. Ni réseau, ni crédit. Voir docs/features/backend-local.md, étape 4.
"""

import asyncio
import sys
from contextlib import contextmanager
from datetime import date, datetime
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock

import pytest

from backend import pipeline_jobs
from backend.ai.gemini_client import ExtractionParsingError, ExtractionUnavailable
from backend.pipeline import phase2_research
from backend.routers import internal
from backend.scheduler import jobs
from backend.scheduler.rotation import Candidate
from backend.tavily_service.key_manager import QuotaExhaustedError

SCHOOL = {"id": "s1", "name": "Em Normandie", "official_domain": "em-normandie.com", "status": "ACTIVE"}
PROGRAMS = [
    {"id": "p1", "name": "Bachelor Management", "schoolId": "s1"},
    {"id": "p3", "name": "Programme Grande École", "schoolId": "s1"},
]
PROGRAM_CAMPUSES = [
    {"program_campus_id": "pc1", "program_id": "p1", "campus_id": "c1",
     "program_name": "Bachelor Management", "campus_name": "Caen"},
]

# Les six cibles d'une passe complète, dans l'ordre où la Phase 2 les traite.
TARGETS = [
    ("SchoolStats", "Em Normandie"),
    ("Accreditation", "Em Normandie"),
    ("Ranking", "Em Normandie"),
    ("Pricing", "Bachelor Management"),
    ("Pricing", "Programme Grande École"),
    ("Capacity", "Bachelor Management @ Caen"),
]

# Ce que Gemini rend pour une cible réussie, et la ligne de production identique.
PAYLOADS = {
    "SchoolStats": {"academic_year": 2027, "total_students": 6400},
    "Accreditation": {"accreditations": [{"name": "EQUIS"}]},
    "Ranking": {"rankings": [{
        "scope": "program", "program_hint": "Programme Grande École",
        "academic_year": 2027, "ranking_name": "Le Figaro", "rank": 12,
    }]},
    "Pricing": {"academic_year": 2027, "currency": "EUR", "total_fee": 52000},
    "Capacity": {"capacities": [{"academic_year": 2027, "spots_available": 120}]},
}
PRODUCTION = {
    "SchoolStatsRecord": {"academic_year": 2027, "total_students": 6400},
    "PricingRecord": {"academic_year": 2027, "currency": "EUR", "total_fee": 52000},
    "RankingRecord": {"programId": "p3", "academic_year": 2027, "ranking_name": "Le Figaro", "rank": 12},
    "CapacityRecord": {"academic_year": 2027, "spots_available": 120},
}

FAILURE_REASONS = [
    "research_failed", "empty_report", "extraction_unavailable", "extraction_failed", "bad_shape",
]


class FakeCursor:
    def __init__(self, db):
        self.db = db
        self._rows: list[dict] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        sql = " ".join(sql.split())
        self._rows = self.db.rows_for(sql, tuple(params))

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)


class FakeDB:
    """
    L'école, ses programmes et ses arêtes ; la production et les tickets en
    attente si on les donne ; les tickets écrits.
    """

    def __init__(self, production: dict | None = None, pending: list[dict] | None = None):
        self.production = production or {}
        self.pending = pending or []
        self.tickets: list[tuple[str, str | None, str | None]] = []

    @contextmanager
    def connection(self):
        conn = MagicMock()
        conn.cursor = lambda cursor_factory=None: FakeCursor(self)
        yield conn

    def rows_for(self, sql: str, params: tuple) -> list[dict]:
        if sql.startswith('INSERT INTO "ContributionInbox"'):
            # (id, schoolId, campusId, programId, programCampusId, ai_category, …)
            self.tickets.append((params[5], params[3], params[4]))
            return []
        if 'FROM "ContributionInbox"' in sql:
            return self.pending
        for table, row in self.production.items():
            if f'FROM "{table}"' in sql:
                return [dict(row)]
        if 'FROM "School"' in sql:
            return [SCHOOL]
        if 'FROM "ProgramCampus"' in sql:
            return PROGRAM_CAMPUSES
        if 'FROM "Program"' in sql:
            return PROGRAMS
        return []


class Phase2:
    """
    Une Phase 2 réelle, Research et Gemini scriptés cible par cible.

    `behaviors` donne le motif voulu par cible (`(catégorie, nom)`), `ok` par
    défaut. La cible en cours est lue au passage dans `_run_research_and_extract`,
    qui reste le vrai.
    """

    def __init__(self, monkeypatch, behaviors=None, production=None, pending=None):
        self.behaviors = behaviors or {}
        self.db = FakeDB(production, pending)
        self.researched: list[tuple[str, str]] = []
        self.extractions: list[tuple[str, str]] = []
        self._current: tuple[str, str] | None = None

        original = phase2_research._run_research_and_extract

        def tracked(**kwargs):
            self._current = (kwargs["category"], kwargs["label"].removeprefix("pour "))
            return original(**kwargs)

        monkeypatch.setattr(phase2_research, "_run_research_and_extract", tracked)
        monkeypatch.setattr(phase2_research, "create_research_task", self._research)
        monkeypatch.setattr(phase2_research, "extract_structured", self._extract)
        monkeypatch.setattr("backend.db.get_db_connection", self.db.connection)

    def _behavior(self) -> str:
        return self.behaviors.get(self._current, "ok")

    def _research(self, *, query, key_manager, include_domains, model, dry_run):
        self.researched.append(self._current)
        behavior = self._behavior()
        if behavior == "research_failed":
            raise RuntimeError("Tavily : 502 Bad Gateway")
        if behavior == "quota":
            raise QuotaExhaustedError("Toutes les clés Tavily sont épuisées")
        if behavior == "empty_report":
            return {"report": "   ", "sources": []}
        category, name = self._current
        return {"report": f"## {category} — {name}", "sources": [{"url": "https://em-normandie.com/x"}]}

    def _extract(self, *, system_prompt, source_text, json_schema, min_tier):
        self.extractions.append(self._current)
        behavior = self._behavior()
        if behavior == "extraction_unavailable":
            raise ExtractionUnavailable("échelle épuisée au-dessus du plancher")
        if behavior == "extraction_failed":
            raise ExtractionParsingError("réponse illisible")
        if behavior == "bad_shape":
            return [PAYLOADS[self._current[0]]]
        return dict(PAYLOADS[self._current[0]])

    def run(self, **kwargs) -> dict:
        return phase2_research.run_phase2_research("s1", "key-manager", **kwargs)


@pytest.fixture(autouse=True)
def _sans_limite_de_programmes(monkeypatch):
    monkeypatch.delenv("PHASE2_MAX_PROGRAMS", raising=False)


def _failed(reason: str, targets=TARGETS) -> list[dict]:
    return [{"category": c, "label": n, "reason": reason} for c, n in targets]


# --- Toutes les cibles échouent ------------------------------------------------------

@pytest.mark.parametrize("reason", FAILURE_REASONS)
def test_toutes_les_cibles_en_echec_la_passe_echoue(monkeypatch, reason):
    phase2 = Phase2(monkeypatch, {target: reason for target in TARGETS})
    result = phase2.run()

    assert result["success"] is False
    assert result["tickets_created"] == 0
    assert result["failed_targets"] == _failed(reason)
    assert result["outcomes"] == {
        "SchoolStats": {reason: 1}, "Accreditation": {reason: 1}, "Ranking": {reason: 1},
        "Pricing": {reason: 2}, "Capacity": {reason: 1},
    }
    assert result["unchanged"] == {}
    assert "6 cible(s) en échec" in result["message"]
    assert phase2.db.tickets == []
    if reason in ("research_failed", "empty_report"):
        assert phase2.extractions == [], "rien à extraire"


def test_un_quota_epuise_est_un_echec_de_recherche(monkeypatch):
    """
    La Phase 2 avale `QuotaExhaustedError` cible par cible. Le chemin du quota
    ne change pas : en rotation, `_QuotaWatch` clôt le job avec son propre
    message (test_research_rotation_job.py). Ici, la cible compte en échec.
    """
    phase2 = Phase2(monkeypatch, {target: "quota" for target in TARGETS})
    result = phase2.run()

    assert result["success"] is False
    assert result["failed_targets"] == _failed("research_failed")


# --- Des échecs mêlés à des tickets --------------------------------------------------

def test_echecs_meles_a_des_tickets_compteurs_justes(monkeypatch):
    phase2 = Phase2(monkeypatch, {
        ("Accreditation", "Em Normandie"): "extraction_unavailable",
        ("Pricing", "Bachelor Management"): "bad_shape",
        ("Capacity", "Bachelor Management @ Caen"): "research_failed",
    })
    result = phase2.run()

    assert result["tickets_created"] == 3
    assert phase2.db.tickets == [
        ("SchoolStats", None, None),
        ("Ranking", "p3", None),
        ("Pricing", "p3", None),
    ]
    assert result["outcomes"] == {
        "SchoolStats": {"ok": 1},
        "Accreditation": {"extraction_unavailable": 1},
        "Ranking": {"ok": 1},
        "Pricing": {"ok": 1, "bad_shape": 1},
        "Capacity": {"research_failed": 1},
    }
    assert result["failed_targets"] == [
        {"category": "Accreditation", "label": "Em Normandie", "reason": "extraction_unavailable"},
        {"category": "Pricing", "label": "Bachelor Management", "reason": "bad_shape"},
        {"category": "Capacity", "label": "Bachelor Management @ Caen", "reason": "research_failed"},
    ]
    assert result["success"] is False
    assert result["message"].startswith("3 ticket(s) créé(s) sur 6 scans")
    assert "3 cible(s) en échec" in result["message"]


def test_une_seule_cible_en_echec_suffit_a_faire_echouer_la_passe(monkeypatch):
    """D2 : l'école repasse 14 jours plus tard au lieu de 182."""
    phase2 = Phase2(monkeypatch, {("Capacity", "Bachelor Management @ Caen"): "extraction_failed"})
    result = phase2.run()

    assert result["tickets_created"] == 5
    assert result["failed_targets"] == _failed("extraction_failed", [("Capacity", "Bachelor Management @ Caen")])
    assert result["success"] is False


def test_le_message_d_echec_reste_court(monkeypatch):
    """Il part dans `PipelineJob.error` et dans le rapport des passes dues."""
    phase2 = Phase2(monkeypatch, {target: "research_failed" for target in TARGETS})
    message = phase2.run()["message"]

    assert "Em Normandie" in message
    assert "Bachelor Management @ Caen" not in message, "au-delà de cinq cibles, un compte"
    assert "(+1)" in message


# --- Rien n'a changé -----------------------------------------------------------------

def test_donnees_inchangees_partout_la_passe_reussit_sans_ticket(monkeypatch):
    """
    Accreditation n'a pas de comparaison à la production
    (`_get_existing_record` rend toujours `None`) : elle écrit un ticket à
    chaque passe, et reste hors de ce test.
    """
    phase2 = Phase2(monkeypatch, production=PRODUCTION)
    result = phase2.run(target_categories=["SchoolStats", "Ranking", "Pricing", "Capacity"])

    assert result["success"] is True
    assert result["tickets_created"] == 0
    assert phase2.db.tickets == []
    assert result["unchanged"] == {"SchoolStats": 1, "Ranking": 1, "Pricing": 2, "Capacity": 1}
    assert result["outcomes"] == {
        "SchoolStats": {"ok": 1}, "Ranking": {"ok": 1}, "Pricing": {"ok": 2}, "Capacity": {"ok": 1},
    }
    assert result["failed_targets"] == []
    assert result["message"] == "0 ticket(s) créé(s) sur 5 scans"


def test_une_passe_sans_echec_reussit(monkeypatch):
    phase2 = Phase2(monkeypatch)
    result = phase2.run()

    assert result["success"] is True
    assert result["tickets_created"] == 6
    assert result["failed_targets"] == []
    assert result["message"] == "6 ticket(s) créé(s) sur 6 scans"


# --- dry_run --------------------------------------------------------------------------

def test_dry_run_ne_compte_aucun_echec_et_n_extrait_rien(monkeypatch):
    phase2 = Phase2(monkeypatch)
    result = phase2.run(dry_run=True)

    assert result["success"] is True
    assert phase2.researched == TARGETS
    assert phase2.extractions == []
    assert phase2.db.tickets == []
    assert result["outcomes"] == {
        "SchoolStats": {"dry_run": 1}, "Accreditation": {"dry_run": 1}, "Ranking": {"dry_run": 1},
        "Pricing": {"dry_run": 2}, "Capacity": {"dry_run": 1},
    }
    assert result["failed_targets"] == []


def test_dry_run_une_recherche_en_echec_reste_un_echec(monkeypatch):
    phase2 = Phase2(monkeypatch, {("Ranking", "Em Normandie"): "research_failed"})
    result = phase2.run(dry_run=True)

    assert result["success"] is False
    assert result["failed_targets"] == _failed("research_failed", [("Ranking", "Em Normandie")])


# --- skip_pending ---------------------------------------------------------------------

def test_une_cible_en_attente_n_est_ni_comptee_ni_en_echec(monkeypatch):
    pending = [{
        "ai_category": "Pricing", "programId": "p1", "programCampusId": None,
        "createdAt": datetime(2026, 9, 15, 8, 0), "is_discovery": False,
    }]
    monkeypatch.setattr(phase2_research, "get_target_period_start", lambda: date(2026, 9, 1))
    phase2 = Phase2(monkeypatch, {target: "research_failed" for target in TARGETS}, pending=pending)
    result = phase2.run(skip_pending=True)

    assert ("Pricing", "Bachelor Management") not in phase2.researched
    assert result["skipped_pending"] == {"school_categories": [], "pricing": 1, "capacity": 0}
    assert result["outcomes"]["Pricing"] == {"research_failed": 1}
    assert result["failed_targets"] == _failed(
        "research_failed", [t for t in TARGETS if t != ("Pricing", "Bachelor Management")],
    )


# --- Les déclencheurs -----------------------------------------------------------------

FAILED_PHASE2 = {
    "success": False,
    "tickets_created": 2,
    "message": "2 ticket(s) créé(s) sur 6 scans ; 1 cible(s) en échec : Capacity « Bachelor Management @ Caen » (recherche en échec)",
    "failed_targets": _failed("research_failed", [("Capacity", "Bachelor Management @ Caen")]),
}


class FakeKeys:
    available_keys = 3

    def get_active_key(self, required_credits=50):
        return "tvly-key"


def test_la_rotation_clot_failed_et_garde_les_cibles_en_echec(monkeypatch):
    finished = []
    monkeypatch.setattr(jobs, "_school_is_busy", lambda school_id: False)
    monkeypatch.setattr(jobs, "_start_rotation_job", lambda school_id, label: "job-1")
    monkeypatch.setattr(
        jobs, "_finish_rotation_job",
        lambda job_id, status, result=None, error=None: finished.append((job_id, status, result, error)),
    )
    monkeypatch.setattr(pipeline_jobs, "update_progress", MagicMock())
    monkeypatch.setattr(phase2_research, "run_phase2_research", MagicMock(return_value=FAILED_PHASE2))

    outcome = jobs._run_rotation_pass(Candidate("s1", "Em Normandie", "2", "never", None, 455), FakeKeys())

    assert outcome.status == "failed"
    assert finished == [("job-1", "failed", FAILED_PHASE2, FAILED_PHASE2["message"])]


@pytest.mark.parametrize("trigger", ["enrichment", "targeted"])
def test_les_declencheurs_manuels_clotent_failed(monkeypatch, trigger):
    completed = []
    fake_main = ModuleType("backend.main")
    fake_main.app = SimpleNamespace(state=SimpleNamespace(tavily_manager=FakeKeys()))
    monkeypatch.setitem(sys.modules, "backend.main", fake_main)
    monkeypatch.setattr(pipeline_jobs, "mark_running", MagicMock())
    monkeypatch.setattr(pipeline_jobs, "update_progress", MagicMock())
    monkeypatch.setattr(
        pipeline_jobs, "complete_job",
        lambda job_id, status, result=None, error=None: completed.append((job_id, status, result, error)),
    )
    monkeypatch.setattr(phase2_research, "run_phase2_research", MagicMock(return_value=FAILED_PHASE2))

    if trigger == "enrichment":
        asyncio.run(internal._run_enrichment("s1", "job-1", []))
    else:
        asyncio.run(internal._run_targeted_research("s1", "job-1", "2", None, ["Capacity"]))

    assert completed == [("job-1", "failed", FAILED_PHASE2, FAILED_PHASE2["message"])]
