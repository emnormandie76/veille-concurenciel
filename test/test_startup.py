"""
Un démarrage raté se voit (F3).

Avant : un échec de la reprise des jobs, du `TavilyKeyManager` ou du
scheduler se réduisait à un avertissement, suivi de « ✅ Backend prêt », et
`/health` répondait `ok`. Désormais, chaque échec est journalisé en `ERROR`,
s'ajoute à `app.state.startup_errors`, et `/health` passe en `degraded`. Le
démarrage vérifie aussi la base : une base injoignable donne une erreur qui
cite le pilote (`DB_DRIVER`).

Le `lifespan` de `backend/main.py` écrit en base, construit le gestionnaire de
clés (qui interroge Tavily) et démarre APScheduler. Ici, tout est remplacé :
aucun test ne touche la base ni le réseau. `backend.main` est importé à neuf,
sans `load_dotenv` et dans un environnement restauré ensuite, pour que
`backend/.env` ne se charge jamais dans le processus de test. Voir
docs/features/backend-local.md, étape 3.
"""

import importlib
import logging
import os
import sys
from unittest.mock import MagicMock, patch

import psycopg2
import pytest
from fastapi.testclient import TestClient

from backend import db, pipeline_jobs
from backend.routers import internal  # noqa: F401 — chargé avant backend.main
from backend.scheduler import jobs

PASSWORD = "s3cr3t-Mot"
DATABASE_URL = f"postgresql://app:{PASSWORD}@ep-test-123.eu-west-2.aws.neon.tech/neondb?sslmode=require"

REAL_GET_POOL = db.get_pool


class FakeKeyManager:
    total_keys = 2


@pytest.fixture
def startup(monkeypatch):
    """Tout ce que le démarrage touche, remplacé ; la base répond."""
    monkeypatch.delenv("DB_DRIVER", raising=False)
    monkeypatch.setenv("DATABASE_URL", DATABASE_URL)
    monkeypatch.setattr(db, "_connection_pool", None)
    # Un pool dont les connexions répondent à tout : `SELECT 1` passe.
    monkeypatch.setattr(db, "get_pool", lambda: MagicMock())
    monkeypatch.setattr(db, "close_pool", MagicMock())
    monkeypatch.setattr(pipeline_jobs, "reap_orphaned_jobs", MagicMock(return_value=0))
    monkeypatch.setattr(pipeline_jobs, "purge_finished_jobs", MagicMock(return_value=0))
    monkeypatch.setattr(jobs, "start_scheduler", MagicMock())
    monkeypatch.setattr(jobs, "stop_scheduler", MagicMock())
    return monkeypatch


@pytest.fixture
def load_main(startup):
    """Importe `backend.main` à neuf, sans `backend/.env`, et l'oublie ensuite."""
    saved = sys.modules.pop("backend.main", None)

    def load(key_manager=FakeKeyManager):
        with patch("dotenv.load_dotenv", return_value=False), patch.dict(os.environ):
            sys.modules.pop("backend.main", None)
            main = importlib.import_module("backend.main")
        startup.setattr(main, "TavilyKeyManager", key_manager)
        return main

    yield load
    sys.modules.pop("backend.main", None)
    if saved is not None:
        sys.modules["backend.main"] = saved


def _health(main) -> tuple[dict, list]:
    with TestClient(main.app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    return response.json(), list(main.app.state.startup_errors)


def test_un_demarrage_sans_erreur_est_ok(load_main):
    main = load_main()
    body, errors = _health(main)

    assert body == {"status": "ok", "version": main.APP_VERSION}
    assert errors == []
    jobs.start_scheduler.assert_called_once()
    pipeline_jobs.reap_orphaned_jobs.assert_called_once_with()


def test_un_gestionnaire_de_cles_qui_leve_degrade_health(load_main, caplog):
    def broken():
        raise RuntimeError("Aucune clé Tavily trouvée.")

    main = load_main(key_manager=broken)
    with caplog.at_level(logging.INFO, logger="pipeline.main"):
        body, errors = _health(main)

    assert body["status"] == "degraded"
    assert len(body["errors"]) == 1
    assert "Aucune clé Tavily trouvée." in body["errors"][0]
    assert errors == body["errors"]
    assert main.app.state.tavily_manager is None
    assert any(
        r.levelno == logging.ERROR and "Aucune clé Tavily trouvée." in r.getMessage()
        for r in caplog.records
    )
    assert not any("Backend prêt" in r.getMessage() for r in caplog.records)


def test_une_base_injoignable_cite_le_pilote(load_main, startup):
    """Le vrai chemin : `get_pool()` lève, son message remonte, sans secret."""
    startup.setattr(db, "get_pool", REAL_GET_POOL)
    startup.setattr(
        db.pool, "ThreadedConnectionPool",
        MagicMock(side_effect=psycopg2.OperationalError("could not connect to server: Connection timed out")),
    )
    main = load_main()
    body, errors = _health(main)

    assert body["status"] == "degraded"
    [error] = errors
    assert "psycopg2 direct" in error
    assert "DB_DRIVER" in error
    assert "could not connect" in error
    assert PASSWORD not in error
    # Base injoignable : la reprise des jobs n'est pas tentée (chaque essai attendrait le délai).
    pipeline_jobs.reap_orphaned_jobs.assert_not_called()


def test_un_scheduler_qui_ne_demarre_pas_degrade_health(load_main, startup):
    startup.setattr(jobs, "start_scheduler", MagicMock(side_effect=ValueError("intervalle invalide")))
    body, _ = _health(load_main())

    assert body["status"] == "degraded"
    assert "intervalle invalide" in body["errors"][0]


def test_une_reprise_des_jobs_en_echec_degrade_health(load_main, startup):
    startup.setattr(pipeline_jobs, "reap_orphaned_jobs", MagicMock(side_effect=RuntimeError("table absente")))
    body, _ = _health(load_main())

    assert body["status"] == "degraded"
    assert "table absente" in body["errors"][0]


def test_la_surface_est_celle_d_un_service_local(load_main, startup):
    """Plus de production côté backend (D5) : `ENVIRONMENT` et `ALLOWED_ORIGINS` ne changent rien."""
    startup.setenv("ENVIRONMENT", "production")
    startup.setenv("ALLOWED_ORIGINS", "https://autre.example")
    main = load_main()

    assert not hasattr(main, "ENVIRONMENT")
    assert not hasattr(main, "IS_PRODUCTION")
    with TestClient(main.app) as client:
        assert client.get("/openapi.json").status_code == 200
        assert client.get("/docs").status_code == 200
        local = client.get("/health", headers={"Origin": "http://localhost:3000"})
        other = client.get("/health", headers={"Origin": "https://autre.example"})

    assert local.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert "access-control-allow-origin" not in other.headers
