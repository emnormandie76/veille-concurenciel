"""
`POST /internal/run-due-passes` : les passes dues, lancées par l'admin.

Plus aucun cron ne paie Research. Cette route est le seul départ d'une passe
de rotation. Ces tests tiennent :
- le jeton : absent, faux, ou non configuré côté serveur → rien ne part ;
- `dry_run` → 200 avec le plan, sans job ni appel Research ;
- réel → 202 avec ce qui va partir, puis l'exécution dans un fil ;
- 409 si une exécution tourne déjà ; 503 sans gestionnaire de clés, et 503
  `USAGE_SYNC_FAILED` si la synchro `/usage` échoue ; 422 hors bornes, ou
  quand `dry_run` n'est pas un booléen explicite.

L'application de test ne porte que le routeur interne : pas de `lifespan`, donc
ni base, ni scheduler, ni gestionnaire de clés réel. Le planificateur, les
phases et la table PipelineJob sont des doubles. Voir
docs/features/backend-local.md, étape 3.
"""

import threading
from contextlib import contextmanager
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import pipeline_jobs
from backend.pipeline import phase1_research, phase2_research
from backend.routers import internal
from backend.scheduler import jobs, rotation
from backend.scheduler.rotation import Candidate, RotationState

TOKEN = "jeton-de-test"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
URL = "/internal/run-due-passes"

ESSEC_P1 = Candidate("s-essec", "Essec", "1", "never", None, 30)
LYON_P2 = Candidate("s-lyon", "Em Lyon", "2", "interval", None, 785)


class FakeKeys:
    available_keys = 3

    def __init__(self, sync_ok=True):
        self.sync_ok = sync_ok
        self.syncs = 0
        self.last_sync = None

    def sync_usage(self, timeout=20):
        self.syncs += 1
        self.last_sync = {
            "ok": self.sync_ok,
            "at": "2026-10-14T08:00:00+00:00",
            "failed_keys": [] if self.sync_ok else ["...bbb222"],
        }
        return dict(self.last_sync)

    def credits_used_this_month(self):
        return 0

    def get_active_key(self, required_credits=50):
        return "tvly-key"


class Backend:
    """Le routeur interne, le planificateur et les phases remplacés."""

    def __init__(self, monkeypatch, candidates):
        self.started: list[tuple] = []
        self.finished: list[tuple] = []
        self.entered = threading.Event()
        self.release = threading.Event()
        self.release.set()
        self.done = threading.Event()

        def phase(school_id, key_manager, **kwargs):
            self.entered.set()
            assert self.release.wait(5)
            return {"success": True, "message": "ok"}

        def start(school_id, phase_label):
            self.started.append((school_id, phase_label))
            return f"job-{len(self.started)}"

        def finish(job_id, status, result=None, error=None):
            self.finished.append((job_id, status))

        record_job_run = jobs._record_job_run

        def record(job_id, status, detail=None):
            record_job_run(job_id, status, detail)
            if job_id == jobs.ROTATION_JOB_ID:
                self.done.set()

        @contextmanager
        def connection():
            yield MagicMock()

        monkeypatch.setenv("INTERNAL_API_TOKEN", TOKEN)
        monkeypatch.delenv("INTERNAL_TOKEN", raising=False)
        monkeypatch.delenv("FASTAPI_INTERNAL_TOKEN", raising=False)
        monkeypatch.setattr(jobs, "_last_job_runs", {})
        monkeypatch.setattr(jobs, "MONTHLY_CREDIT_CEILING", 7000)
        monkeypatch.setattr("backend.db.get_db_connection", connection)
        monkeypatch.setattr(pipeline_jobs, "reap_stale_jobs", MagicMock(return_value=0))
        monkeypatch.setattr(pipeline_jobs, "update_progress", MagicMock())
        monkeypatch.setattr(rotation, "load_rotation_state", MagicMock(return_value=RotationState()))
        monkeypatch.setattr(rotation, "plan_rotation", MagicMock(return_value=candidates))
        monkeypatch.setattr(jobs, "_school_is_busy", lambda school_id: False)
        monkeypatch.setattr(jobs, "_start_rotation_job", start)
        monkeypatch.setattr(jobs, "_finish_rotation_job", finish)
        monkeypatch.setattr(jobs, "_record_job_run", record)
        monkeypatch.setattr(phase1_research, "run_phase1_research", MagicMock(side_effect=phase))
        monkeypatch.setattr(phase2_research, "run_phase2_research", MagicMock(side_effect=phase))

        self.keys = FakeKeys()
        self.app = FastAPI()
        self.app.include_router(internal.router)
        self.app.state.tavily_manager = self.keys

    @contextmanager
    def client(self):
        # Le portail du client garde sa boucle (et son exécuteur) ouverts entre
        # les requêtes ; on rend la main aux fils avant de le fermer.
        with TestClient(self.app) as client:
            try:
                yield client
            finally:
                self.release.set()


@pytest.fixture
def backend(monkeypatch):
    return Backend(monkeypatch, [ESSEC_P1, LYON_P2])


@pytest.fixture
def forbidden_run(monkeypatch):
    """`run_due_passes` ne doit pas être appelé."""
    spy = MagicMock(side_effect=AssertionError("run_due_passes appelé"))
    monkeypatch.setattr(jobs, "run_due_passes", spy)
    return spy


# ── Le jeton ──────────────────────────────────────────────────────


def test_sans_jeton_rien_ne_part(backend, forbidden_run):
    with backend.client() as client:
        response = client.post(URL, json={"max_passes": 1, "dry_run": False})

    assert response.status_code == 401
    forbidden_run.assert_not_called()


def test_jeton_faux_rien_ne_part(backend, forbidden_run):
    with backend.client() as client:
        response = client.post(
            URL, json={"max_passes": 1, "dry_run": False},
            headers={"Authorization": "Bearer pas-le-bon"},
        )

    assert response.status_code == 401
    forbidden_run.assert_not_called()


def test_jeton_non_configure_cote_serveur(backend, forbidden_run, monkeypatch):
    monkeypatch.delenv("INTERNAL_API_TOKEN")
    with backend.client() as client:
        response = client.post(URL, json={"max_passes": 1, "dry_run": False}, headers=AUTH)

    assert response.status_code == 500
    forbidden_run.assert_not_called()


# ── Simulation ────────────────────────────────────────────────────


def test_simulation_rend_le_plan_en_200(backend):
    with backend.client() as client:
        response = client.post(URL, json={"max_passes": 2, "dry_run": True}, headers=AUTH)

    assert response.status_code == 200
    body = response.json()
    assert body["dry_run"] is True
    assert body["status"] == "success"
    assert [(p["school_name"], p["phase"]) for p in body["planned"]] == [("Essec", "1"), ("Em Lyon", "2")]
    assert body["launched"] == []
    assert backend.started == []
    assert backend.keys.syncs == 0


# ── Passe réelle ──────────────────────────────────────────────────


def test_passe_reelle_202_puis_execution_dans_un_fil(backend):
    backend.release.clear()
    with backend.client() as client:
        response = client.post(URL, json={"max_passes": 1, "dry_run": False}, headers=AUTH)

        # La réponse est partie avant la fin de la passe : elle annonce le plan.
        assert response.status_code == 202
        body = response.json()
        assert body["status"] == "planned"
        assert body["dry_run"] is False
        assert [(p["school_name"], p["phase"]) for p in body["planned"]] == [("Essec", "1")]
        assert body["usage_sync"]["ok"] is True

        assert backend.entered.wait(5), "la passe tourne dans un fil"
        assert backend.finished == []
        backend.release.set()
        assert backend.done.wait(5), "l'issue est inscrite au registre"

    assert backend.started == [("s-essec", pipeline_jobs.PHASE1_CRON_LABEL)]
    assert backend.finished == [("job-1", "completed")]
    assert jobs._last_job_runs[jobs.ROTATION_JOB_ID]["status"] == "success"


def test_409_si_une_execution_tourne_deja(backend):
    backend.release.clear()
    with backend.client() as client:
        first = client.post(URL, json={"max_passes": 1, "dry_run": False}, headers=AUTH)
        assert first.status_code == 202
        assert backend.entered.wait(5)

        second = client.post(URL, json={"max_passes": 1, "dry_run": False}, headers=AUTH)

        assert second.status_code == 409
        assert second.json()["detail"]["code"] == "ALREADY_RUNNING"
        backend.release.set()
        assert backend.done.wait(5)

    assert len(backend.started) == 1


# ── 503 ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("dry_run", [True, False])
def test_503_sans_gestionnaire_de_cles(backend, forbidden_run, dry_run):
    backend.app.state.tavily_manager = None
    with backend.client() as client:
        response = client.post(URL, json={"max_passes": 1, "dry_run": dry_run}, headers=AUTH)

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "KEY_MANAGER_MISSING"
    forbidden_run.assert_not_called()


def test_503_si_la_synchro_usage_echoue(backend):
    backend.keys.sync_ok = False
    with backend.client() as client:
        response = client.post(URL, json={"max_passes": 1, "dry_run": False}, headers=AUTH)

    assert response.status_code == 503
    detail = response.json()["detail"]
    assert detail["code"] == "USAGE_SYNC_FAILED"
    assert detail["usage_sync"]["failed_keys"] == ["...bbb222"]
    assert backend.started == []


# ── 422 ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("body", [
    {"max_passes": 0, "dry_run": True},
    {"max_passes": 6, "dry_run": True},
    {"max_passes": 2.5, "dry_run": True},
    # Une passe réelle ne part jamais par défaut : `dry_run` est exigé...
    {"max_passes": 1},
    # ... et doit être un booléen, pas une valeur qui se lirait comme un non.
    {"max_passes": 1, "dry_run": "false"},
    {"max_passes": 1, "dry_run": 0},
    # Une faute de frappe sur un champ ne doit pas le laisser à son défaut.
    {"max_passes": 1, "dryRun": True},
    {"max_passes": 1, "dry_run": True, "max_pass": 3},
])
def test_422_hors_bornes(backend, forbidden_run, body):
    with backend.client() as client:
        response = client.post(URL, json=body, headers=AUTH)

    assert response.status_code == 422
    forbidden_run.assert_not_called()
