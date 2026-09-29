"""
Les jobs qui paient Research ne demarrent pas sur un poste de developpement.

Le 2026-09-28, demarrer uvicorn en local lancait phase1_scanner 5 minutes plus
tard sur EMLV et Essec, sans que personne n'ait clique. Voir
research_cron_enabled() dans backend/scheduler/jobs.py. Le job qui paie
Research est desormais research_rotation, a heure fixe : la regle est la meme.
"""

from unittest.mock import patch

import pytest
from apscheduler.triggers.cron import CronTrigger

from backend.scheduler import jobs


@pytest.fixture
def env(monkeypatch):
    monkeypatch.delenv("CRON_RESEARCH_ENABLED", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    return monkeypatch


def test_hors_production_par_defaut_les_jobs_research_sont_coupes(env):
    enabled, reason = jobs.research_cron_enabled()
    assert enabled is False
    assert "development" in reason


@pytest.mark.parametrize("value", ["production", "prod", " Production "])
def test_en_production_ils_sont_actifs(env, value):
    env.setenv("ENVIRONMENT", value)
    assert jobs.research_cron_enabled()[0] is True


@pytest.mark.parametrize("value", ["true", "1", "YES", "on"])
def test_le_forcage_les_active_hors_production(env, value):
    env.setenv("ENVIRONMENT", "development")
    env.setenv("CRON_RESEARCH_ENABLED", value)
    assert jobs.research_cron_enabled()[0] is True


@pytest.mark.parametrize("value", ["false", "0", "no", "off"])
def test_le_forcage_les_coupe_meme_en_production(env, value):
    env.setenv("ENVIRONMENT", "production")
    env.setenv("CRON_RESEARCH_ENABLED", value)
    assert jobs.research_cron_enabled()[0] is False


def test_une_valeur_inconnue_coupe_au_lieu_de_payer(env):
    """Une faute de frappe doit couter une passe de cron, pas des credits."""
    env.setenv("ENVIRONMENT", "production")
    env.setenv("CRON_RESEARCH_ENABLED", "ture")
    enabled, reason = jobs.research_cron_enabled()
    assert enabled is False
    assert "ture" in reason


def _registered_jobs(monkeypatch) -> dict:
    """Demarre un scheduler neuf, rend ses jobs par id, puis l'arrete."""
    monkeypatch.setattr(jobs, "_scheduler", None)
    scheduler = jobs.get_scheduler()
    with patch.object(scheduler, "start"):
        jobs.start_scheduler(key_manager=None)
    registered = {job.id: job for job in scheduler.get_jobs()}
    monkeypatch.setattr(jobs, "_scheduler", None)
    return registered


def test_start_scheduler_hors_production_ninscrit_que_le_crowdsourcing(env):
    assert sorted(_registered_jobs(env)) == ["crowdsourcing_processor"]


def test_start_scheduler_en_production_inscrit_la_rotation_a_heure_fixe(env):
    env.setenv("ENVIRONMENT", "production")
    env.setattr(jobs, "RESEARCH_HOUR", 5)
    registered = _registered_jobs(env)

    assert sorted(registered) == ["crowdsourcing_processor", "research_rotation"]
    rotation = registered["research_rotation"]
    assert isinstance(rotation.trigger, CronTrigger)
    fields = {f.name: str(f) for f in rotation.trigger.fields}
    assert (fields["hour"], fields["minute"]) == ("5", "0")
    assert str(rotation.trigger.timezone) == "Europe/Paris"
    assert rotation.misfire_grace_time == 3600
    assert rotation.coalesce is True
    assert rotation.max_instances == 1
