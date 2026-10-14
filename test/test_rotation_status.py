"""
Le bloc `rotation` de pipeline-status : les passes dues, ce qu'elles ont coûté
et l'état de la synchro `/usage`, lisibles dans `/admin/cron` sans ouvrir les
journaux.

Ces tests tiennent sa forme (plus d'heure, de fuseau ni de « nuit » : il n'y a
plus de cron), et qu'une lecture en base qui échoue se rende dans le bloc sans
faire tomber pipeline-status, que le panneau admin appelle toutes les cinq
secondes. Ils tiennent aussi, dans pipeline-status, le tri des jobs de passe
(`source` vaut `"rotation"`, ou `"cron"` pour les lignes de l'ancien cron) et
les erreurs de démarrage. Scheduler, base et gestionnaire de clés sont des
doubles. Voir `_rotation_status()` dans backend/scheduler/jobs.py et
docs/features/backend-local.md, étape 3.
"""

import asyncio
import types
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from backend import pipeline_jobs
from backend.routers import internal
from backend.scheduler import jobs, rotation
from backend.scheduler.rotation import Candidate, RotationState

ESSEC_P1 = Candidate("s-essec", "Essec", "1", "never", None, 30)
LYON_P2 = Candidate(
    "s-lyon", "Em Lyon", "2", "interval",
    datetime(2026, 3, 1, 3, 12, tzinfo=timezone.utc), 785,
)
LAST_RUN = {
    "status": "success",
    "detail": "Em Lyon, Phase 2, ~785 crédits",
    "finished_at": "2026-10-14T09:47:00+00:00",
}
USAGE_SYNC = {"ok": True, "at": "2026-10-14T08:00:00+00:00", "failed_keys": []}


class FakeKeys:
    last_sync = USAGE_SYNC

    def credits_used_this_month(self):
        return 1240

    def get_status(self):
        return []


@pytest.fixture
def backend(monkeypatch):
    """Base et planificateur remplacés ; le registre de la dernière exécution rempli."""
    @contextmanager
    def connection():
        yield MagicMock()

    monkeypatch.setattr("backend.db.get_db_connection", connection)
    monkeypatch.setattr(rotation, "load_rotation_state", MagicMock(return_value=RotationState()))
    monkeypatch.setattr(
        rotation, "plan_rotation",
        MagicMock(return_value=[ESSEC_P1, LYON_P2] + [ESSEC_P1] * 5),
    )
    monkeypatch.setattr(jobs, "MONTHLY_CREDIT_CEILING", 7000)
    monkeypatch.setattr(jobs, "_last_job_runs", {jobs.ROTATION_JOB_ID: LAST_RUN})
    return monkeypatch


def _running_scheduler(monkeypatch):
    job = MagicMock(id=jobs.CROWDSOURCING_JOB_ID, next_run_time=None)
    job.name = "Traitement des contributions"
    scheduler = MagicMock(running=True)
    scheduler.get_jobs.return_value = [job]
    monkeypatch.setattr(jobs, "_scheduler", scheduler)


def _pipeline_status(monkeypatch, *, active_jobs=(), startup_errors=None):
    monkeypatch.setattr("backend.db.check_db_connection", lambda: True)
    monkeypatch.setattr(pipeline_jobs, "list_active_jobs", lambda limit=20: list(active_jobs))
    monkeypatch.setattr(pipeline_jobs, "purge_finished_jobs", lambda: 0)
    state = types.SimpleNamespace(tavily_manager=FakeKeys())
    if startup_errors is not None:
        state.startup_errors = startup_errors
    request = types.SimpleNamespace(app=types.SimpleNamespace(state=state))
    return asyncio.run(internal.pipeline_status(request, _token="jeton"))


def test_le_bloc_rotation_est_present_et_bien_forme(backend):
    _running_scheduler(backend)
    status = jobs.get_scheduler_status(FakeKeys())

    assert "research_cron" not in status
    assert status["rotation"] == {
        "interval_days": rotation.INTERVAL_DAYS,
        "monthly_ceiling": 7000,
        "month_credits_used": 1240,
        "due_count": 7,
        "next": [
            {"school_name": "Essec", "phase": "1", "reason": "never",
             "last_pass_at": None, "estimated_credits": 30},
            {"school_name": "Em Lyon", "phase": "2", "reason": "interval",
             "last_pass_at": "2026-03-01T03:12:00+00:00", "estimated_credits": 785},
            *[{"school_name": "Essec", "phase": "1", "reason": "never",
               "last_pass_at": None, "estimated_credits": 30}] * 3,
        ],
        "last_run": LAST_RUN,
        "usage_sync": USAGE_SYNC,
    }


def test_sans_gestionnaire_de_cles_le_plan_se_lit_quand_meme(backend):
    _running_scheduler(backend)
    status = jobs.get_scheduler_status(None)

    assert status["rotation"]["month_credits_used"] is None, "sans gestionnaire de clés"
    assert status["rotation"]["usage_sync"] is None
    assert len(status["rotation"]["next"]) == 5


def test_aucune_execution_depuis_le_demarrage(backend):
    backend.setattr(jobs, "_last_job_runs", {})
    _running_scheduler(backend)

    assert jobs.get_scheduler_status(FakeKeys())["rotation"]["last_run"] is None


def test_scheduler_arrete_le_bloc_est_la_quand_meme(backend):
    backend.setattr(jobs, "_scheduler", None)
    status = jobs.get_scheduler_status(FakeKeys())

    assert status["running"] is False
    assert status["jobs"] == []
    assert status["has_failure"] is False
    assert status["rotation"]["due_count"] == 7


def test_une_erreur_de_lecture_ne_casse_pas_pipeline_status(backend):
    _running_scheduler(backend)
    backend.setattr(rotation, "load_rotation_state", MagicMock(side_effect=RuntimeError("P1001 Neon injoignable")))

    response = _pipeline_status(backend)

    assert response["scheduler"]["rotation"] == {"error": "P1001 Neon injoignable"}
    assert response["scheduler"]["running"] is True
    assert response["status"] == "ok"
    assert response["database"] == "connected"
    assert response["startup_errors"] == []


def test_les_jobs_de_passe_sont_tries_a_part(backend):
    """`"rotation"` aujourd'hui, `"cron"` pour les lignes de l'ancien cron restées en base."""
    _running_scheduler(backend)
    active = [
        {"job_id": "j1", "source": "manual"},
        {"job_id": "j2", "source": "rotation"},
        {"job_id": "j3", "source": "cron"},
        {"job_id": "j4", "source": None},
    ]

    response = _pipeline_status(backend, active_jobs=active)

    assert [job["job_id"] for job in response["pipeline_jobs"]] == ["j1", "j4"]
    # Nom de clé historique : app/admin/cron/page.tsx le lit.
    assert [job["job_id"] for job in response["cron_jobs"]] == ["j2", "j3"]
    assert response["pipeline_jobs_active"] == 4


def test_les_erreurs_de_demarrage_degradent_pipeline_status(backend):
    _running_scheduler(backend)
    errors = ["Gestionnaire de clés Tavily : Aucune clé Tavily trouvée."]

    response = _pipeline_status(backend, startup_errors=errors)

    assert response["startup_errors"] == errors
    assert response["status"] == "degraded"
