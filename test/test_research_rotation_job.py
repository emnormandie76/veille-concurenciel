"""
Le job nocturne `research_rotation` : au plus une passe par nuit, sous plafond.

Il remplace phase1_scanner et phase2_enricher, qui repassaient sur tout à des
intervalles comptés depuis le démarrage. Ces tests tiennent : le plafond
mensuel (et le plafond 0 de la vérification à blanc), le battement de cœur des
passes, les drapeaux passés aux phases, et l'arrêt de la nuit sur un quota
épuisé — y compris quand la phase avale l'exception, ce que font les deux.
Ni base, ni réseau, ni Tavily : planificateur, phases et table PipelineJob sont
des doubles. Voir backend/scheduler/jobs.py et
docs/features/cron-rotation-production.md, étape 4.
"""

import logging
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest

from backend import pipeline_jobs
from backend.pipeline import phase1_research, phase2_research
from backend.scheduler import jobs, rotation
from backend.scheduler.rotation import Candidate, RotationState
from backend.tavily_service.key_manager import QuotaExhaustedError

NORMANDIE_P2 = Candidate("s-normandie", "Em Normandie", "2", "never", None, 720)
LYON_P2 = Candidate("s-lyon", "Em Lyon", "2", "interval", None, 785)
ESSEC_P1 = Candidate("s-essec", "Essec", "1", "never", None, 30)


class FakeKeys:
    """Le TavilyKeyManager, réduit à ce que le job et les phases lui demandent."""

    def __init__(self, used=0, available=3, refuse=False):
        self.used = used
        self.available_keys = available
        self.refuse = refuse

    def credits_used_this_month(self):
        return self.used

    def get_active_key(self, required_credits=50):
        if self.refuse:
            raise QuotaExhaustedError("Toutes les clés Tavily sont insuffisantes")
        return "tvly-key"


class Night:
    """Une nuit de rotation, tout ce qui coûte ou écrit étant remplacé."""

    def __init__(self, monkeypatch, candidates, *, ceiling=7000, passes=1,
                 phase1=None, phase2=None, busy=(), job_ids=True):
        self.candidates = candidates
        self.finished: list[tuple] = []
        self.records: list[tuple] = []
        self.started: list[tuple] = []
        self.phase1 = MagicMock(side_effect=phase1 or (lambda *a, **k: {"success": True, "message": "ok"}))
        self.phase2 = MagicMock(side_effect=phase2 or (lambda *a, **k: {"success": True, "message": "ok"}))
        self.progress = MagicMock()

        def start(school_id, phase):
            self.started.append((school_id, phase))
            return f"job-{len(self.started)}" if job_ids else None

        @contextmanager
        def connection():
            yield MagicMock()

        monkeypatch.setattr(jobs, "MONTHLY_CREDIT_CEILING", ceiling)
        monkeypatch.setattr(jobs, "PASSES_PER_NIGHT", passes)
        monkeypatch.setattr("backend.db.get_db_connection", connection)
        monkeypatch.setattr(pipeline_jobs, "reap_stale_jobs", MagicMock(return_value=0))
        monkeypatch.setattr(pipeline_jobs, "update_progress", self.progress)
        monkeypatch.setattr(rotation, "load_rotation_state", MagicMock(return_value=RotationState()))
        monkeypatch.setattr(rotation, "plan_rotation", MagicMock(return_value=candidates))
        monkeypatch.setattr(jobs, "_school_is_busy", lambda school_id: school_id in busy)
        monkeypatch.setattr(jobs, "_start_cron_job", start)
        monkeypatch.setattr(
            jobs, "_finish_cron_job",
            lambda job_id, status, result=None, error=None: self.finished.append((job_id, status, error)),
        )
        monkeypatch.setattr(jobs, "_record_job_run", lambda *args: self.records.append(args))
        monkeypatch.setattr(phase1_research, "run_phase1_research", self.phase1)
        monkeypatch.setattr(phase2_research, "run_phase2_research", self.phase2)

    def run(self, keys):
        jobs.research_rotation(keys)
        return self

    @property
    def record(self):
        [(job_id, status, detail)] = self.records
        assert job_id == "research_rotation"
        return status, detail


# --- Le plafond ------------------------------------------------------------------

def test_un_candidat_trop_cher_est_saute_pour_le_suivant_qui_tient(monkeypatch):
    night = Night(monkeypatch, [NORMANDIE_P2, ESSEC_P1]).run(FakeKeys(used=6900))

    night.phase2.assert_not_called()
    assert night.phase1.call_args.args[0] == "s-essec"
    assert night.started == [("s-essec", pipeline_jobs.PHASE1_CRON_LABEL)]
    assert night.finished == [("job-1", "completed", None)]
    assert night.record == ("success", "Essec, Phase 1, ~30 crédits")


def test_plafond_zero_planifie_journalise_et_ne_depense_rien(monkeypatch, caplog):
    night = Night(monkeypatch, [NORMANDIE_P2, ESSEC_P1], ceiling=0)
    with caplog.at_level(logging.INFO, logger="pipeline.scheduler"):
        night.run(FakeKeys(used=0))

    night.phase1.assert_not_called()
    night.phase2.assert_not_called()
    assert night.started == []
    status, detail = night.record
    assert status == "success"
    assert detail.startswith("plafond mensuel atteint : 0/0 crédits, 2 passe(s) en attente")
    plan_line = next(r.getMessage() for r in caplog.records if "passe(s) due(s)" in r.getMessage())
    assert "Em Normandie, Phase 2, ~720 crédits (never)" in plan_line
    assert "Essec, Phase 1, ~30 crédits (never)" in plan_line


def test_au_plus_une_passe_par_nuit_par_defaut(monkeypatch):
    night = Night(monkeypatch, [NORMANDIE_P2, LYON_P2, ESSEC_P1]).run(FakeKeys())

    assert night.started == [("s-normandie", pipeline_jobs.PHASE2_CRON_LABEL)]
    night.phase1.assert_not_called()


# --- La passe ----------------------------------------------------------------------

def test_le_battement_de_coeur_met_a_jour_le_job(monkeypatch):
    def phase2(school_id, key_manager, **kwargs):
        kwargs["progress_callback"]({"current_action": "Recherche Pricing", "progress": "4/48"})
        return {"success": True, "message": "3 ticket(s)"}

    night = Night(monkeypatch, [NORMANDIE_P2], phase2=phase2).run(FakeKeys())

    night.progress.assert_called_once_with(
        "job-1", {"current_action": "Recherche Pricing", "progress": "4/48"}
    )


def test_drapeaux_des_phases(monkeypatch):
    night = Night(monkeypatch, [NORMANDIE_P2, ESSEC_P1], passes=2).run(FakeKeys())

    assert night.phase2.call_args.kwargs["skip_pending"] is True
    assert night.phase1.call_args.kwargs["collect_campus_attachments"] is False
    assert [status for _, status, _ in night.finished] == ["completed", "completed"]
    assert night.record[0] == "success"


def test_une_ecole_occupee_laisse_la_place_au_candidat_suivant(monkeypatch):
    night = Night(monkeypatch, [NORMANDIE_P2, ESSEC_P1], busy={"s-normandie"}).run(FakeKeys())

    assert night.started == [("s-essec", pipeline_jobs.PHASE1_CRON_LABEL)]


def test_un_echec_de_phase_clot_le_job_en_failed(monkeypatch):
    night = Night(
        monkeypatch, [ESSEC_P1],
        phase1=lambda *a, **k: {"success": False, "message": "le rapport ne nomme aucun campus"},
    ).run(FakeKeys())

    assert night.finished == [("job-1", "failed", "le rapport ne nomme aucun campus")]
    assert night.record == ("failed", "Essec, Phase 1, ~30 crédits — le rapport ne nomme aucun campus")


def test_sans_job_en_base_la_passe_n_est_pas_lancee(monkeypatch):
    """Le job est la mémoire du passage : sans lui, l'école serait repayée demain."""
    night = Night(monkeypatch, [NORMANDIE_P2, ESSEC_P1], passes=2, job_ids=False).run(FakeKeys())

    night.phase1.assert_not_called()
    night.phase2.assert_not_called()
    assert night.started == [("s-normandie", pipeline_jobs.PHASE2_CRON_LABEL)]
    assert night.record[0] == "failed"


# --- Le quota ------------------------------------------------------------------------

def test_quota_exhausted_error_clot_le_job_et_la_nuit(monkeypatch):
    def phase2(*args, **kwargs):
        raise QuotaExhaustedError("Toutes les clés Tavily sont épuisées")

    night = Night(monkeypatch, [NORMANDIE_P2, LYON_P2, ESSEC_P1], passes=3, phase2=phase2).run(FakeKeys())

    assert night.started == [("s-normandie", pipeline_jobs.PHASE2_CRON_LABEL)]
    assert night.finished == [("job-1", "failed", "Toutes les clés Tavily sont épuisées")]
    night.phase1.assert_not_called()
    assert night.record[0] == "failed"


def test_un_refus_de_cle_avale_par_la_phase_clot_aussi_la_nuit(monkeypatch):
    """
    La vraie Phase 2 : `_run_research_and_extract` attrape l'exception et passe à
    la cible suivante, puis la passe se termine « réussie ».
    """
    def phase2(school_id, key_manager, **kwargs):
        try:
            key_manager.get_active_key(required_credits=250)
        except QuotaExhaustedError:
            pass
        return {"success": True, "tickets_created": 0, "message": "0 ticket(s) créé(s) sur 48 scans"}

    night = Night(monkeypatch, [NORMANDIE_P2, ESSEC_P1], passes=2, phase2=phase2).run(FakeKeys(refuse=True))

    assert night.finished == [("job-1", "failed", jobs._QUOTA_CUT_ERROR)]
    night.phase1.assert_not_called()


def test_des_cles_toutes_epuisees_apres_la_passe_la_rendent_incomplete(monkeypatch):
    night = Night(monkeypatch, [NORMANDIE_P2, ESSEC_P1], passes=2).run(FakeKeys(available=0))

    assert night.finished == [("job-1", "failed", jobs._QUOTA_CUT_ERROR)]
    night.phase1.assert_not_called()


# --- Les cas vides ---------------------------------------------------------------------

def test_aucune_passe_due(monkeypatch):
    night = Night(monkeypatch, []).run(FakeKeys())
    assert night.record == ("success", "aucune passe due")
    assert night.started == []


def test_sans_gestionnaire_de_cles_rien_ne_part(monkeypatch):
    night = Night(monkeypatch, [ESSEC_P1]).run(None)
    assert night.record[0] == "failed"
    assert night.started == []


@pytest.mark.parametrize("raw, expected", [("4", 4), ("24", 3), ("-1", 3), ("trois", 3)])
def test_heure_de_la_rotation(monkeypatch, raw, expected):
    from backend.utils.env import env_int

    monkeypatch.setenv("CRON_RESEARCH_HOUR", raw)
    assert env_int("CRON_RESEARCH_HOUR", 3, minimum=0, maximum=23) == expected
