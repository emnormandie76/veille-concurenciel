"""
La synchro `/usage` bloquante du gestionnaire de clés Tavily (F8).

Les compteurs de crédits vivent en mémoire et repartent de zéro à chaque
démarrage. En local, chaque lancement est un démarrage : si la synchro
d'arrière-plan échouait, le plafond mensuel croyait le mois vierge. Une passe
réelle appelle donc `sync_usage()` d'abord, et ne part pas si une clé n'a pas
pu être recalée. Ces tests tiennent :
- `sync_usage()` recale chaque clé et mémorise `last_sync = {ok, at, failed_keys}` ;
- une clé en erreur, en retard au-delà du délai, ou une réponse sans bloc
  `key` → `ok` faux, la clé nommée par son suffixe seulement ;
- le démarrage lance toujours la synchro en arrière-plan.

`urllib.request.urlopen` est remplacé : tout appel non prévu par le test
échoue sur place. Aucun test ne part sur le réseau.
"""

import io
import json
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime

import pytest

from backend.tavily_service.key_manager import TavilyKeyManager

KEY_A = "tvly-aaaaaa111111"
KEY_B = "tvly-bbbbbb222222"


class FakeResponse(io.BytesIO):
    def __init__(self, payload, status=200):
        super().__init__(json.dumps(payload).encode("utf-8"))
        self.status = status


def _usage(usage, limit=1000):
    return {"key": {"usage": usage, "limit": limit}}


class FakeTavily:
    """`urlopen` simulé : une réponse (ou une exception) par clé."""

    def __init__(self, answers):
        self.answers = answers
        self.calls: list[tuple[str, float]] = []

    def __call__(self, request, timeout=None):
        assert request.full_url == "https://api.tavily.com/usage"
        key = request.get_header("Authorization").removeprefix("Bearer ")
        self.calls.append((key, timeout))
        answer = self.answers[key]
        if callable(answer):
            answer = answer()
        if isinstance(answer, Exception):
            raise answer
        return FakeResponse(answer)


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEYS", f"{KEY_A},{KEY_B}")
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    for i in range(1, 11):
        monkeypatch.delenv(f"TAVILY_API_KEY_{i}", raising=False)

    def forbidden(*args, **kwargs):
        raise AssertionError("appel réseau non prévu par le test")

    monkeypatch.setattr(urllib.request, "urlopen", forbidden)
    return monkeypatch


@pytest.fixture
def manager(env):
    # Pas de synchro au démarrage : chaque test pilote la sienne.
    env.setattr(TavilyKeyManager, "_sync_usage_in_background", lambda self: None)
    return TavilyKeyManager()


def _credits(manager):
    return [key.credits_used for key in manager._keys]


def test_aucune_synchro_connue_avant_la_premiere(manager):
    assert manager.last_sync is None


def test_une_synchro_reussie_recale_chaque_cle(manager, env):
    tavily = FakeTavily({KEY_A: _usage(420), KEY_B: _usage(37, limit=4000)})
    env.setattr(urllib.request, "urlopen", tavily)

    result = manager.sync_usage(timeout=7)

    assert result["ok"] is True
    assert result["failed_keys"] == []
    assert datetime.fromisoformat(result["at"]).tzinfo is not None
    assert manager.last_sync == result
    assert _credits(manager) == [420, 37]
    assert manager._keys[1].credits_limit == 4000
    assert sorted(key for key, _ in tavily.calls) == [KEY_A, KEY_B]
    assert {timeout for _, timeout in tavily.calls} == {7}


def test_le_compteur_local_ne_recule_jamais(manager, env):
    manager._keys[0].credits_used = 600
    env.setattr(urllib.request, "urlopen", FakeTavily({KEY_A: _usage(420), KEY_B: _usage(0)}))

    assert manager.sync_usage()["ok"] is True
    assert _credits(manager) == [600, 0]


def test_une_cle_en_erreur_fait_echouer_la_synchro(manager, env):
    env.setattr(urllib.request, "urlopen", FakeTavily({
        KEY_A: _usage(420),
        KEY_B: urllib.error.URLError("connexion refusée"),
    }))

    result = manager.sync_usage()

    assert result["ok"] is False
    assert result["failed_keys"] == ["...222222"]
    assert KEY_B not in json.dumps(result), "la clé entière ne sort jamais"
    assert _credits(manager) == [420, 0]
    assert manager.last_sync == result


def test_une_reponse_sans_bloc_key_est_un_echec(manager, env):
    env.setattr(urllib.request, "urlopen", FakeTavily({KEY_A: _usage(420), KEY_B: {"account": {}}}))

    result = manager.sync_usage()

    assert result["ok"] is False
    assert result["failed_keys"] == ["...222222"]


def test_une_cle_en_retard_au_dela_du_delai_fait_echouer_la_synchro(manager, env):
    release = threading.Event()

    def slow():
        release.wait(5)
        return _usage(1)

    env.setattr(urllib.request, "urlopen", FakeTavily({KEY_A: _usage(420), KEY_B: slow}))
    try:
        started = time.monotonic()
        result = manager.sync_usage(timeout=0.3)
        elapsed = time.monotonic() - started
    finally:
        release.set()

    assert elapsed < 3
    assert result["ok"] is False
    assert result["failed_keys"] == ["...222222"]


def test_le_demarrage_lance_la_synchro_en_arriere_plan(env):
    done = threading.Event()
    calls = []

    def fake_sync(self, timeout=20.0):
        calls.append(threading.current_thread() is threading.main_thread())
        done.set()
        return {"ok": True, "at": None, "failed_keys": []}

    env.setattr(TavilyKeyManager, "sync_usage", fake_sync)
    TavilyKeyManager()

    assert done.wait(5)
    assert calls == [False], "la synchro du démarrage ne bloque pas le démarrage"
