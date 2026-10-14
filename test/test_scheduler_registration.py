"""
Le scheduler n'inscrit que le traitement des contributions.

Plus aucun job planifié ne paie Research : les passes dues partent quand
l'admin les demande (`POST /internal/run-due-passes`). Ces tests gardent
contre le retour d'un cron qui paierait seul, quelles que soient les
anciennes variables (`ENVIRONMENT`, `CRON_RESEARCH_ENABLED`).

Ils tiennent aussi le crowdsourcing :
- première passe dès le démarrage, pour traiter l'arriéré `Pending_AI` ;
- intervalle illisible ramené au défaut, au lieu d'empêcher le scheduler
  entier de démarrer (F9) ;
- chaque passage inscrit au registre de `get_scheduler_status()`, y compris
  une lecture de la base en échec, qui se terminait par un `return` muet (F4).

Ni base ni réseau. Voir backend/scheduler/jobs.py et
docs/features/backend-local.md, étape 3.
"""

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from apscheduler.triggers.interval import IntervalTrigger

from backend.crowdsourcing import processor
from backend.scheduler import jobs
from backend.tavily_service.key_manager import QuotaExhaustedError

POOL_ERROR = (
    "Connexion PostgreSQL impossible (pilote : psycopg2 direct, hôte : "
    "ep-test.eu-west-2.aws.neon.tech) : OperationalError: timeout expired"
)


@pytest.fixture
def env(monkeypatch):
    for name in ("ENVIRONMENT", "CRON_RESEARCH_ENABLED", "CRON_CROWDSOURCING_INTERVAL_MINUTES"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(jobs, "_last_job_runs", {})
    # Le bloc `rotation` lit la base : hors sujet ici.
    monkeypatch.setattr(jobs, "_rotation_status", lambda key_manager: {})
    return monkeypatch


def _registered_jobs(monkeypatch) -> dict:
    """Démarre un scheduler neuf sans le lancer, rend ses jobs par id."""
    monkeypatch.setattr(jobs, "_scheduler", None)
    scheduler = jobs.get_scheduler()
    with patch.object(scheduler, "start"):
        jobs.start_scheduler(key_manager=None)
    registered = {job.id: job for job in scheduler.get_jobs()}
    monkeypatch.setattr(jobs, "_scheduler", None)
    return registered


def _run_crowdsourcing(monkeypatch) -> None:
    """Un passage du job inscrit, comme APScheduler l'appellerait."""
    job = _registered_jobs(monkeypatch)[jobs.CROWDSOURCING_JOB_ID]
    job.func(*job.args, **job.kwargs)


def _queue(rows):
    """Une connexion dont la lecture de la file rend `rows`."""
    cursor = MagicMock()
    cursor.fetchall.return_value = rows
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor

    @contextmanager
    def connection():
        yield conn

    return connection


@contextmanager
def _unreachable():
    raise RuntimeError(POOL_ERROR)
    yield  # pragma: no cover


# ── Aucun cron Research ───────────────────────────────────────────


@pytest.mark.parametrize("environment, research_enabled", [
    (None, None),
    ("production", None),
    ("production", "true"),
    ("development", "1"),
])
def test_seul_le_crowdsourcing_est_inscrit(env, environment, research_enabled):
    """Les anciennes variables du cron n'inscrivent plus rien."""
    if environment:
        env.setenv("ENVIRONMENT", environment)
    if research_enabled:
        env.setenv("CRON_RESEARCH_ENABLED", research_enabled)

    assert sorted(_registered_jobs(env)) == [jobs.CROWDSOURCING_JOB_ID]


def test_le_cron_research_a_disparu_du_module():
    for name in ("research_rotation", "research_cron_enabled", "RESEARCH_HOUR",
                 "PASSES_PER_NIGHT", "ROTATION_TIMEZONE"):
        assert not hasattr(jobs, name), name


# ── Crowdsourcing : inscription ───────────────────────────────────


def test_le_crowdsourcing_part_des_le_demarrage(env):
    before = datetime.now(timezone.utc)
    job = _registered_jobs(env)[jobs.CROWDSOURCING_JOB_ID]
    after = datetime.now(timezone.utc)

    assert job.next_run_time is not None
    assert before - timedelta(seconds=1) <= job.next_run_time <= after + timedelta(seconds=1)


@pytest.mark.parametrize("raw, minutes", [
    (None, 1),
    ("5", 5),
    ("cinq", 1),
    ("0", 1),
    ("-3", 1),
    (" ", 1),
])
def test_intervalle_du_crowdsourcing(env, raw, minutes):
    """Une valeur illisible retombe sur le défaut au lieu de bloquer le démarrage (F9)."""
    if raw is not None:
        env.setenv("CRON_CROWDSOURCING_INTERVAL_MINUTES", raw)

    job = _registered_jobs(env)[jobs.CROWDSOURCING_JOB_ID]

    assert isinstance(job.trigger, IntervalTrigger)
    assert job.trigger.interval == timedelta(minutes=minutes)


# ── Crowdsourcing : registre des passages (F4) ────────────────────


def test_une_lecture_de_base_en_echec_se_lit_dans_le_registre(env):
    env.setattr("backend.db.get_db_connection", _unreachable)

    _run_crowdsourcing(env)  # ne lève pas : APScheduler n'en saurait rien

    status = jobs.get_scheduler_status()
    run = status["last_runs"][jobs.CROWDSOURCING_JOB_ID]
    assert run["status"] == "failed"
    assert "psycopg2 direct" in run["detail"]
    assert status["has_failure"] is True


def test_process_pending_submissions_leve_au_lieu_de_rendre_muet(env):
    env.setattr("backend.db.get_db_connection", _unreachable)

    with pytest.raises(processor.SubmissionQueueUnavailable, match="psycopg2 direct"):
        processor.process_pending_submissions(None)


def test_une_file_vide_est_un_passage_reussi(env):
    env.setattr("backend.db.get_db_connection", _queue([]))

    _run_crowdsourcing(env)

    run = jobs.get_scheduler_status()["last_runs"][jobs.CROWDSOURCING_JOB_ID]
    assert run["status"] == "success"
    assert run["detail"] == "aucune contribution en attente"


def test_le_detail_compte_les_tickets_traites(env):
    env.setattr("backend.db.get_db_connection", _queue([
        {"id": "t1", "ai_category": "Pricing"},
        {"id": "t2", "ai_category": "Pricing"},
    ]))
    env.setattr(processor, "process_crowdsourcing_ticket", MagicMock(return_value=None))

    _run_crowdsourcing(env)

    run = jobs.get_scheduler_status()["last_runs"][jobs.CROWDSOURCING_JOB_ID]
    assert run["status"] == "success"
    assert run["detail"].startswith("2 contribution(s) : 2 en attente de l'admin")


def test_un_quota_tavily_epuise_se_lit_comme_un_echec(env):
    """Les contributions restent en `Pending_AI` : l'admin doit le voir."""
    env.setattr("backend.db.get_db_connection", _queue([{"id": "t1", "ai_category": "Pricing"}]))
    env.setattr(
        processor, "process_crowdsourcing_ticket",
        MagicMock(side_effect=QuotaExhaustedError("Toutes les clés Tavily sont insuffisantes")),
    )

    _run_crowdsourcing(env)

    run = jobs.get_scheduler_status()["last_runs"][jobs.CROWDSOURCING_JOB_ID]
    assert run["status"] == "failed"
    assert "quota Tavily épuisé" in run["detail"]
