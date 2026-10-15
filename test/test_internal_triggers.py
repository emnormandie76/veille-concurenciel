"""
Les déclencheurs de l'API interne (backend/routers/internal.py) :
`trigger-scan`, `trigger-enrichment`, `trigger-targeted-research`.

Plan backend-local, étape 7 (P1) : jeton absent côté serveur → erreur
explicite ; jeton faux → 401 ; pour chaque déclencheur : école inconnue →
404, occupée → 409, exception → job `failed`.

Deux écarts au plan ont été tranchés par le propriétaire le 14 octobre 2026 :
une école inconnue n'était pas vérifiée (l'INSERT du job violait la clé
étrangère, 500 sans explication), et une école occupée répondait 200 avec
`already_running: true`. Désormais 404 `SCHOOL_NOT_FOUND` et 409
`ALREADY_RUNNING`, comme `run-due-passes`, sans job créé.

L'application de test ne porte que le routeur interne ; `backend.main` est un
faux module, pour que `backend/.env` ne se charge jamais. Ni base ni réseau.
"""

import asyncio
import sys
from contextlib import contextmanager
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import pipeline_jobs
from backend.pipeline import phase1_research, phase2_research
from backend.routers import internal

TOKEN = "jeton-de-test"
AUTH = {"Authorization": f"Bearer {TOKEN}"}

TRIGGERS = {
    "scan": ("/internal/trigger-scan/{id}", {}, pipeline_jobs.PHASE1_LABEL),
    "enrichment": ("/internal/trigger-enrichment/{id}", {"categories": ["Pricing"]}, pipeline_jobs.PHASE2_LABEL),
    "targeted": ("/internal/trigger-targeted-research/{id}", {"phase": "1"}, pipeline_jobs.PHASE1_LABEL),
}
KNOWN_SCHOOLS = {"s-normandie"}


class Backend:
    def __init__(self, monkeypatch, *, active_job=None):
        self.created = []
        self.spawned = []
        self.schools_read = []

        class Cursor:
            def __init__(self):
                self._row = None

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(cursor, sql, params=()):
                assert 'FROM "School"' in sql
                self.schools_read.append(params[0])
                cursor._row = (params[0],) if params[0] in KNOWN_SCHOOLS else None

            def fetchone(cursor):
                return cursor._row

        @contextmanager
        def connection():
            conn = MagicMock()
            conn.cursor = lambda cursor_factory=None: Cursor()
            yield conn

        def create_job(school_id, phase, source="manual", progress=None):
            self.created.append((school_id, phase, source))
            return f"job-{len(self.created)}"

        def spawn(coro):
            self.spawned.append(coro.__name__)
            coro.close()  # rien ne tourne en arrière-plan pendant le test

        monkeypatch.setenv("INTERNAL_API_TOKEN", TOKEN)
        monkeypatch.delenv("INTERNAL_TOKEN", raising=False)
        monkeypatch.delenv("FASTAPI_INTERNAL_TOKEN", raising=False)
        monkeypatch.setattr("backend.db.get_db_connection", connection)
        monkeypatch.setattr(pipeline_jobs, "get_active_job", lambda school_id: active_job)
        monkeypatch.setattr(pipeline_jobs, "create_job", create_job)
        monkeypatch.setattr(internal, "_spawn", spawn)

        app = FastAPI()
        app.include_router(internal.router)
        self.client = TestClient(app)


def _post(backend, trigger, school_id="s-normandie", headers=AUTH, body=None):
    url, default_body, _label = TRIGGERS[trigger]
    return backend.client.post(url.format(id=school_id), json=default_body if body is None else body,
                               headers=headers)


# ── Jeton ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("trigger", sorted(TRIGGERS))
def test_sans_jeton_ou_jeton_faux_rien_ne_part(monkeypatch, trigger):
    backend = Backend(monkeypatch)

    assert _post(backend, trigger, headers={}).status_code == 401
    assert _post(backend, trigger, headers={"Authorization": "Bearer faux"}).status_code == 401
    assert backend.created == [] and backend.spawned == []


@pytest.mark.parametrize("trigger", sorted(TRIGGERS))
def test_jeton_non_configure_cote_serveur_erreur_explicite(monkeypatch, trigger):
    backend = Backend(monkeypatch)
    monkeypatch.delenv("INTERNAL_API_TOKEN")

    res = _post(backend, trigger)

    assert res.status_code == 500
    assert "INTERNAL_API_TOKEN non configuré" in res.json()["detail"]
    assert backend.created == []


# ── Cas nominal ──────────────────────────────────────────────────────

@pytest.mark.parametrize("trigger", sorted(TRIGGERS))
def test_cas_nominal_un_job_en_file_et_une_tache_de_fond(monkeypatch, trigger):
    backend = Backend(monkeypatch)

    res = _post(backend, trigger)

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "queued"
    assert body["job_id"] == "job-1"
    assert backend.created == [("s-normandie", TRIGGERS[trigger][2], "manual")]
    assert len(backend.spawned) == 1


# ── École inconnue → 404 ─────────────────────────────────────────────

@pytest.mark.parametrize("trigger", sorted(TRIGGERS))
def test_ecole_inconnue_404_sans_job(monkeypatch, trigger):
    backend = Backend(monkeypatch)

    res = _post(backend, trigger, school_id="s-inconnue")

    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "SCHOOL_NOT_FOUND"
    assert "s-inconnue" in res.json()["detail"]["message"]
    assert backend.created == [] and backend.spawned == []


# ── École occupée → 409 ──────────────────────────────────────────────

@pytest.mark.parametrize("trigger", sorted(TRIGGERS))
def test_ecole_occupee_409_sans_job(monkeypatch, trigger):
    busy = {"job_id": "job-actif", "status": "running", "phase": pipeline_jobs.PHASE2_LABEL}
    backend = Backend(monkeypatch, active_job=busy)

    res = _post(backend, trigger)

    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["code"] == "ALREADY_RUNNING"
    assert detail["job_id"] == "job-actif"
    assert "job-actif" in detail["message"]
    assert backend.created == [] and backend.spawned == []


def test_l_ecole_est_verifiee_avant_le_verrou(monkeypatch):
    """Inconnue ET « occupée » : c'est l'absence qui est dite."""
    backend = Backend(monkeypatch, active_job={"job_id": "j", "status": "running", "phase": "x"})

    assert _post(backend, "scan", school_id="s-inconnue").status_code == 404


def test_un_parametre_invalide_est_refuse_avant_toute_lecture(monkeypatch):
    backend = Backend(monkeypatch)

    res = _post(backend, "targeted", body={"phase": "3"})

    assert res.status_code == 400
    assert backend.schools_read == [] and backend.created == []


# ── Exception dans la tâche de fond → job failed ─────────────────────

@pytest.fixture
def fake_main(monkeypatch):
    """`backend.main` sans son chargement d'environnement."""
    module = ModuleType("backend.main")
    module.app = SimpleNamespace(state=SimpleNamespace(tavily_manager=object()))
    monkeypatch.setitem(sys.modules, "backend.main", module)
    return module


@pytest.fixture
def job_store(monkeypatch):
    store = SimpleNamespace(completed=[])
    monkeypatch.setattr(pipeline_jobs, "mark_running", MagicMock())
    monkeypatch.setattr(pipeline_jobs, "update_progress", MagicMock())
    monkeypatch.setattr(
        pipeline_jobs, "complete_job",
        lambda job_id, status, result=None, error=None: store.completed.append((job_id, status, error)),
    )
    return store


RUNNERS = {
    "scan": (phase1_research, "run_phase1_research", lambda: internal._run_scan("s-normandie", "job-1")),
    "enrichment": (phase2_research, "run_phase2_research",
                   lambda: internal._run_enrichment("s-normandie", "job-1", ["Pricing"])),
    "targeted-1": (phase1_research, "run_phase1_research",
                   lambda: internal._run_targeted_research("s-normandie", "job-1", "1", None, None)),
    "targeted-2": (phase2_research, "run_phase2_research",
                   lambda: internal._run_targeted_research("s-normandie", "job-1", "2", "p-1", ["Pricing"])),
}


@pytest.mark.parametrize("runner", sorted(RUNNERS))
def test_une_exception_dans_la_phase_clot_le_job_en_failed(monkeypatch, fake_main, job_store, runner):
    module, name, run = RUNNERS[runner]
    monkeypatch.setattr(module, name, MagicMock(side_effect=RuntimeError("Gemini saturé")))

    asyncio.run(run())

    assert job_store.completed == [("job-1", "failed", "Gemini saturé")]


@pytest.mark.parametrize("runner", sorted(RUNNERS))
def test_sans_gestionnaire_de_cles_le_job_est_failed(monkeypatch, fake_main, job_store, runner):
    module, name, run = RUNNERS[runner]
    phase = MagicMock()
    monkeypatch.setattr(module, name, phase)
    fake_main.app.state.tavily_manager = None

    asyncio.run(run())

    [(job_id, status, error)] = job_store.completed
    assert (job_id, status) == ("job-1", "failed")
    assert "TavilyKeyManager" in error
    phase.assert_not_called()
