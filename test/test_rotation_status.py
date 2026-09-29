"""
Le bloc `rotation` de pipeline-status : ce que la rotation va faire et ce
qu'elle a coûté, lisible dans `/admin/cron` sans ouvrir les journaux.

Ces tests tiennent sa forme, et qu'une lecture en base qui échoue se rende dans
le bloc sans faire tomber pipeline-status — le panneau admin l'appelle toutes
les cinq secondes. Scheduler, base et gestionnaire de clés sont des doubles.
Voir `_rotation_status()` dans backend/scheduler/jobs.py et
docs/features/cron-rotation-production.md, étape 5.
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


class FakeKeys:
    def credits_used_this_month(self):
        return 1240

    def get_status(self):
        return []


@pytest.fixture
def backend(monkeypatch):
    """Base et planificateur remplacés ; le registre de la dernière nuit rempli."""
    @contextmanager
    def connection():
        yield MagicMock()

    monkeypatch.setattr("backend.db.get_db_connection", connection)
    monkeypatch.setattr(rotation, "load_rotation_state", MagicMock(return_value=RotationState()))
    monkeypatch.setattr(
        rotation, "plan_rotation",
        MagicMock(return_value=[ESSEC_P1, LYON_P2] + [ESSEC_P1] * 5),
    )
    monkeypatch.setattr(jobs, "RESEARCH_HOUR", 3)
    monkeypatch.setattr(jobs, "MONTHLY_CREDIT_CEILING", 7000)
    monkeypatch.setattr(jobs, "PASSES_PER_NIGHT", 1)
    monkeypatch.setattr(jobs, "_last_job_runs", {
        "research_rotation": {
            "status": "success",
            "detail": "Em Lyon, Phase 2, ~785 crédits",
            "finished_at": "2026-09-29T01:47:00+00:00",
        },
    })
    return monkeypatch


def _running_scheduler(monkeypatch, with_rotation=True):
    job = MagicMock(id="research_rotation", next_run_time=None)
    job.name = "Rotation des recherches"
    scheduler = MagicMock(running=True)
    scheduler.get_jobs.return_value = [job] if with_rotation else []
    scheduler.get_job.side_effect = lambda job_id: job if with_rotation and job_id == job.id else None
    monkeypatch.setattr(jobs, "_scheduler", scheduler)


def test_le_bloc_rotation_est_present_et_bien_forme(backend):
    _running_scheduler(backend)
    status = jobs.get_scheduler_status(FakeKeys())

    assert status["rotation"] == {
        "enabled": True,
        "hour": 3,
        "timezone": "Europe/Paris",
        "interval_days": rotation.INTERVAL_DAYS,
        "passes_per_night": 1,
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
        "last_night": {
            "status": "success",
            "detail": "Em Lyon, Phase 2, ~785 crédits",
            "finished_at": "2026-09-29T01:47:00+00:00",
        },
    }


def test_hors_production_la_rotation_est_inactive_mais_son_plan_se_lit(backend):
    _running_scheduler(backend, with_rotation=False)
    status = jobs.get_scheduler_status(None)

    assert status["rotation"]["enabled"] is False
    assert status["rotation"]["month_credits_used"] is None, "sans gestionnaire de clés"
    assert len(status["rotation"]["next"]) == 5
    assert "research_cron" in status


def test_scheduler_arrete_le_bloc_est_la_quand_meme(backend):
    backend.setattr(jobs, "_scheduler", None)
    status = jobs.get_scheduler_status(FakeKeys())

    assert status["running"] is False
    assert status["rotation"]["enabled"] is False
    assert status["rotation"]["due_count"] == 7


def test_une_erreur_de_lecture_ne_casse_pas_pipeline_status(backend):
    _running_scheduler(backend)
    backend.setattr(rotation, "load_rotation_state", MagicMock(side_effect=RuntimeError("P1001 Neon injoignable")))
    backend.setattr("backend.db.check_db_connection", lambda: True)
    backend.setattr(pipeline_jobs, "list_active_jobs", lambda limit=20: [])
    backend.setattr(pipeline_jobs, "purge_finished_jobs", lambda: 0)
    request = types.SimpleNamespace(app=types.SimpleNamespace(state=types.SimpleNamespace(tavily_manager=FakeKeys())))

    response = asyncio.run(internal.pipeline_status(request, _token="jeton"))

    assert response["scheduler"]["rotation"] == {"error": "P1001 Neon injoignable"}
    assert response["scheduler"]["running"] is True
    assert response["status"] == "ok"
    assert response["database"] == "connected"
