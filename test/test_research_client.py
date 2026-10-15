"""
Le client Tavily Research (backend/tavily_service/research_client.py).

Un appel Research coûte de 15 à 50 crédits en « pro ». Le compteur local du
gestionnaire de clés fait autorité pour le plafond mensuel : un compteur faux
fausse le plafond. Plan backend-local, étape 7 (P0) : échecs de polling
consécutifs, délai maximal, erreur de quota → `QuotaExhaustedError`, crédits
estimés enregistrés, `dry_run`.

Ni réseau ni attente : `TavilyClient` est remplacé par un faux qui rejoue un
scénario, et l'horloge du module par une horloge simulée que `sleep` avance.
"""

from types import SimpleNamespace

import pytest

from backend.tavily_service import research_client
from backend.tavily_service.key_manager import QuotaExhaustedError
from backend.tavily_service.research_client import (
    ESTIMATED_CREDITS,
    MAX_CONSECUTIVE_POLL_FAILURES,
    ResearchTaskFailedError,
    ResearchTimeoutError,
    create_research_task,
)

KEY_A = "tvly-test-cle-aaaaaa"
KEY_B = "tvly-test-cle-bbbbbb"
QUOTA_MESSAGE = "This request exceeds your plan's set usage limit. Please upgrade your plan"


class FakeKeys:
    def __init__(self, keys=(KEY_A, KEY_B)):
        self.keys = list(keys)
        self.exhausted = []
        self.usage = []
        self.requested = []

    @property
    def total_keys(self):
        return len(self.keys)

    def get_active_key(self, required_credits=50):
        self.requested.append(required_credits)
        for key in self.keys:
            if key not in self.exhausted:
                return key
        raise QuotaExhaustedError("Toutes les clés Tavily sont insuffisantes")

    def record_usage(self, api_key, credits=1):
        self.usage.append((api_key, credits))

    def mark_exhausted(self, api_key):
        self.exhausted.append(api_key)


class Tavily:
    """Les clients créés pendant un test, et le scénario qu'ils rejouent.

    `create[clé]` : ce que rend (ou lève) `research()` pour cette clé.
    `polls` : la suite des réponses de `get_research()` ; une exception y est
    levée. La dernière entrée se répète.
    """

    def __init__(self):
        self.create = {}
        self.polls = [{"status": "completed", "content": "rapport", "sources": []}]
        self.clients = []
        self.research_calls = []
        self.poll_count = 0

    def factory(self, api_key):
        tavily = self

        class Client:
            def research(self, **params):
                tavily.research_calls.append((api_key, params))
                outcome = tavily.create.get(api_key, {"request_id": f"req-{api_key[-6:]}"})
                if isinstance(outcome, Exception):
                    raise outcome
                return outcome

            def get_research(self, request_id):
                index = min(tavily.poll_count, len(tavily.polls) - 1)
                tavily.poll_count += 1
                outcome = tavily.polls[index]
                if isinstance(outcome, Exception):
                    raise outcome
                return outcome

        tavily.clients.append(api_key)
        return Client()


@pytest.fixture
def tavily(monkeypatch):
    fake = Tavily()
    monkeypatch.setattr(research_client, "TavilyClient", lambda api_key: fake.factory(api_key))
    clock = SimpleNamespace(now=1_000_000.0, sleeps=[])

    def sleep(seconds):
        clock.sleeps.append(seconds)
        clock.now += seconds

    monkeypatch.setattr(research_client, "time", SimpleNamespace(time=lambda: clock.now, sleep=sleep))
    fake.clock = clock
    return fake


# ── dry_run ──────────────────────────────────────────────────────────

def test_dry_run_ne_demande_aucune_cle_et_n_appelle_rien(tavily):
    keys = FakeKeys()

    result = create_research_task("Frais de l'EM Normandie", keys, model="pro", dry_run=True)

    assert result["status"] == "dry_run"
    assert result["credits_used"] == 0
    assert keys.requested == [] and keys.usage == []
    assert tavily.clients == []


# ── Cas nominal et crédits estimés ───────────────────────────────────

def test_pro_attend_completed_et_enregistre_l_estimation(tavily):
    keys = FakeKeys()
    tavily.polls = [
        {"status": "pending"},
        {"status": "in_progress"},
        {"status": "completed", "content": "Rapport", "sources": [{"url": "https://x"}]},
    ]

    result = create_research_task(
        "Frais", keys, include_domains=["em-normandie.com"], model="pro", poll_interval=5.0,
    )

    assert result == {
        "report": "Rapport",
        "sources": [{"url": "https://x"}],
        "credits_used": ESTIMATED_CREDITS["pro"],
        "status": "completed",
        "request_id": "req-aaaaaa",
    }
    assert keys.requested == [research_client.REQUIRED_CREDITS_PRO]
    assert keys.usage == [(KEY_A, ESTIMATED_CREDITS["pro"])]
    assert tavily.research_calls == [
        (KEY_A, {"input": "Frais", "model": "pro", "include_domains": ["em-normandie.com"]}),
    ]
    assert tavily.clock.sleeps == [5.0, 5.0]


def test_mini_reserve_moins_et_compte_moins(tavily):
    keys = FakeKeys()

    create_research_task("Classements", keys, model="mini")

    assert keys.requested == [research_client.REQUIRED_CREDITS_MINI]
    assert keys.usage == [(KEY_A, ESTIMATED_CREDITS["mini"])]
    # Sans include_domains ni schéma, rien d'autre n'est envoyé.
    assert tavily.research_calls == [(KEY_A, {"input": "Classements", "model": "mini"})]


def test_pas_de_request_id_echec_explicite_sans_credit(tavily):
    keys = FakeKeys()
    tavily.create[KEY_A] = {"status": "accepted"}

    with pytest.raises(ResearchTaskFailedError, match="request_id"):
        create_research_task("Frais", keys)
    assert keys.usage == []


# ── Échecs de polling consécutifs ────────────────────────────────────

def test_des_echecs_isoles_sont_absorbes(tavily):
    keys = FakeKeys()
    flaky = ConnectionError("réseau coupé")
    tavily.polls = (
        [flaky] * (MAX_CONSECUTIVE_POLL_FAILURES - 1)
        + [{"status": "pending"}]
        + [flaky] * (MAX_CONSECUTIVE_POLL_FAILURES - 1)
        + [{"status": "completed", "content": "ok"}]
    )

    result = create_research_task("Frais", keys)

    assert result["report"] == "ok"
    assert keys.usage == [(KEY_A, ESTIMATED_CREDITS["pro"])]


def test_trop_d_echecs_consecutifs_abandon_sans_attendre_le_delai(tavily):
    keys = FakeKeys()
    tavily.polls = [{"status": "pending"}] + [ConnectionError("tâche perdue")]

    with pytest.raises(ResearchTaskFailedError, match="injoignable") as error:
        create_research_task("Frais", keys, max_wait_seconds=600, poll_interval=5.0)

    assert tavily.poll_count == 1 + MAX_CONSECUTIVE_POLL_FAILURES
    assert isinstance(error.value.__cause__, ConnectionError)
    # Ni nouvelle clé, ni clé marquée épuisée : ce n'est pas un quota.
    assert tavily.clients == [KEY_A]
    assert keys.exhausted == []
    # La tâche existe chez Tavily, qui l'a sans doute facturée : elle est
    # comptée. Jusqu'au 14 octobre 2026, elle ne l'était pas, et le plafond
    # sous-estimait jusqu'à la synchro /usage suivante (constat de l'étape 7,
    # corrigé avec l'accord du propriétaire).
    assert keys.usage == [(KEY_A, ESTIMATED_CREDITS["pro"])]


def test_le_delai_maximal_est_tenu(tavily):
    keys = FakeKeys()
    tavily.polls = [{"status": "pending"}]

    with pytest.raises(ResearchTimeoutError, match="60s"):
        create_research_task("Frais", keys, max_wait_seconds=60, poll_interval=5.0)

    assert tavily.poll_count == 12
    assert sum(tavily.clock.sleeps) == 60
    assert keys.usage == [(KEY_A, ESTIMATED_CREDITS["pro"])]  # comptée, comme ci-dessus


def test_une_tache_en_echec_chez_tavily_ne_change_pas_de_cle(tavily):
    keys = FakeKeys()
    tavily.polls = [{"status": "failed", "error": "source introuvable"}]

    with pytest.raises(ResearchTaskFailedError, match="source introuvable"):
        create_research_task("Frais", keys, model="mini")

    assert tavily.clients == [KEY_A]
    assert keys.exhausted == []
    assert keys.usage == [(KEY_A, ESTIMATED_CREDITS["mini"])]


def test_une_tache_reussie_n_est_comptee_qu_une_fois(tavily):
    keys = FakeKeys()
    tavily.polls = [{"status": "pending"}, {"status": "completed", "content": "ok"}]

    create_research_task("Frais", keys)

    assert keys.usage == [(KEY_A, ESTIMATED_CREDITS["pro"])]


# ── Quota ────────────────────────────────────────────────────────────

def test_une_erreur_de_quota_marque_la_cle_et_passe_a_la_suivante(tavily):
    keys = FakeKeys()
    tavily.create[KEY_A] = RuntimeError(QUOTA_MESSAGE)

    result = create_research_task("Frais", keys)

    assert result["status"] == "completed"
    assert keys.exhausted == [KEY_A]
    assert tavily.clients == [KEY_A, KEY_B]
    assert keys.usage == [(KEY_B, ESTIMATED_CREDITS["pro"])]


def test_toutes_les_cles_au_quota_quota_exhausted_error(tavily):
    keys = FakeKeys()
    tavily.create[KEY_A] = RuntimeError(QUOTA_MESSAGE)
    tavily.create[KEY_B] = RuntimeError("HTTP 432: quota exceeded")

    with pytest.raises(QuotaExhaustedError, match="2 tentatives"):
        create_research_task("Frais", keys)

    assert keys.exhausted == [KEY_A, KEY_B]
    assert keys.usage == []


def test_aucune_cle_disponible_l_erreur_remonte_sans_appel(tavily):
    keys = FakeKeys(keys=())

    with pytest.raises(QuotaExhaustedError):
        create_research_task("Frais", keys)
    assert tavily.clients == []


def test_aucune_cle_assez_garnie_l_erreur_remonte(tavily):
    keys = FakeKeys()
    keys.exhausted = [KEY_A, KEY_B]

    with pytest.raises(QuotaExhaustedError):
        create_research_task("Frais", keys)
    assert tavily.clients == []


def test_une_autre_erreur_remonte_sans_essayer_d_autre_cle(tavily):
    keys = FakeKeys()
    tavily.create[KEY_A] = ValueError("paramètre invalide : model")

    with pytest.raises(ValueError, match="paramètre invalide"):
        create_research_task("Frais", keys)

    assert tavily.clients == [KEY_A]
    assert keys.exhausted == []
    assert keys.usage == []
