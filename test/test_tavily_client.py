"""
Le client Tavily : `search_web` et `extract_from_urls`
(backend/tavily_service/client.py).

Plan backend-local, étape 7 (P1) : quota → exception typée ; lots de 5 URL.

Jusqu'au 14 octobre 2026, un refus de quota de l'API ou une panne réseau était
avalé : la fonction rendait "", que le traitement des contributions lisait
comme un contenu vide, donc une erreur permanente — le ticket était
SUPPRIMÉ. Une panne passagère détruisait une contribution valide (constat de
l'étape 7, corrigé avec l'accord du propriétaire). Désormais :

- refus de quota → clé marquée épuisée, clé suivante, puis
  `QuotaExhaustedError` quand aucune ne passe (comme `map_program_pages`) ;
- autre échec de l'appel → `TavilyRequestError` ;
- extraction réussie mais vide → "" : c'est la seule réponse vide.

Ni réseau ni clé réelle : `TavilyClient` est remplacé (il est importé dans
chaque fonction, d'où le remplacement dans le module `tavily`).
"""

import logging

import pytest

from backend.tavily_service import client as tavily_client
from backend.tavily_service.client import (
    EXTRACT_MAX_URLS,
    TavilyRequestError,
    extract_from_urls,
    search_web,
    split_extractable_urls,
)
from backend.tavily_service.key_manager import QuotaExhaustedError

KEYS = ["tvly-test-aaaaaa", "tvly-test-bbbbbb", "tvly-test-cccccc", "tvly-test-dddddd"]
QUOTA_MESSAGE = "This request exceeds your plan's set usage limit"
LONG_CONTENT = "Frais de scolarité 2026-2027 : 14 500 € par an, hors frais de dossier et CVEC."


class FakeKeys:
    def __init__(self, keys=KEYS):
        self.keys = list(keys)
        self.exhausted = []
        self.usage = []

    def get_active_key(self, required_credits=50):
        for key in self.keys:
            if key not in self.exhausted:
                return key
        raise QuotaExhaustedError("Toutes les clés Tavily sont insuffisantes")

    def record_usage(self, api_key, credits=1):
        self.usage.append((api_key, credits))

    def mark_exhausted(self, api_key):
        self.exhausted.append(api_key)


class Tavily:
    """`outcomes[clé]` : ce que rend ou lève l'appel pour cette clé."""

    def __init__(self):
        self.outcomes = {}
        self.calls = []

    def factory(self, api_key):
        tavily = self

        class Client:
            def _run(self, method, params):
                tavily.calls.append((api_key, method, params))
                outcome = tavily.outcomes.get(api_key, {"results": [{"url": "https://emlv.fr/x", "raw_content": LONG_CONTENT}]})
                if isinstance(outcome, Exception):
                    raise outcome
                return outcome

            def extract(self, **params):
                return self._run("extract", params)

            def search(self, **params):
                return self._run("search", params)

        return Client()


@pytest.fixture
def tavily(monkeypatch):
    fake = Tavily()
    monkeypatch.setattr("tavily.TavilyClient", lambda api_key: fake.factory(api_key))
    return fake


@pytest.fixture(params=["extract", "search"])
def call(request, tavily):
    """Les deux fonctions, appelées de la même façon."""
    if request.param == "extract":
        return lambda keys: extract_from_urls(["https://emlv.fr/tarifs"], keys)
    return lambda keys: search_web("Frais EMLV", keys, include_domains=["emlv.fr"])


# ── Lots de 5 URL ────────────────────────────────────────────────────

def test_split_extractable_urls():
    urls = [f"https://emlv.fr/{i}" for i in range(7)]
    kept, ignored = split_extractable_urls(urls)

    assert EXTRACT_MAX_URLS == 5
    assert kept == urls[:5]
    assert ignored == urls[5:]
    assert split_extractable_urls(None) == ([], [])


def test_extract_n_envoie_que_5_url_et_journalise_le_surplus(tavily, caplog):
    keys = FakeKeys()
    urls = [f"https://emlv.fr/page-{i}" for i in range(7)]

    with caplog.at_level(logging.WARNING, logger="pipeline.tavily_client"):
        content = extract_from_urls(urls, keys)

    [(_key, method, params)] = tavily.calls
    assert method == "extract"
    assert params["urls"] == urls[:5]
    assert "## Source: https://emlv.fr/x" in content
    assert keys.usage == [(KEYS[0], 1)]  # 1 crédit par lot de 5
    assert any("2 URL(s) écartée(s)" in r.getMessage() for r in caplog.records)


def test_extract_sans_url_ne_demande_rien(tavily):
    keys = FakeKeys()
    assert extract_from_urls([], keys) == ""
    assert tavily.calls == []


def test_une_extraction_reussie_mais_vide_rend_une_chaine_vide(tavily):
    keys = FakeKeys()
    tavily.outcomes[KEYS[0]] = {"results": [{"url": "https://emlv.fr/x", "raw_content": "trop court"}]}

    assert extract_from_urls(["https://emlv.fr/x"], keys) == ""
    tavily.outcomes[KEYS[0]] = {"results": []}
    assert extract_from_urls(["https://emlv.fr/x"], keys) == ""


# ── Quota → exception typée ──────────────────────────────────────────

def test_un_refus_de_quota_passe_a_la_cle_suivante(call, tavily):
    keys = FakeKeys()
    tavily.outcomes[KEYS[0]] = RuntimeError(QUOTA_MESSAGE)

    content = call(keys)

    assert LONG_CONTENT in content
    assert keys.exhausted == [KEYS[0]]
    assert [c[0] for c in tavily.calls] == [KEYS[0], KEYS[1]]
    assert keys.usage[-1][0] == KEYS[1]


def test_toutes_les_cles_refusees_quota_exhausted_error(call, tavily):
    keys = FakeKeys(keys=KEYS[:2])
    for key in KEYS[:2]:
        tavily.outcomes[key] = RuntimeError("HTTP 432: quota exceeded")

    with pytest.raises(QuotaExhaustedError):
        call(keys)
    assert keys.exhausted == KEYS[:2]


def test_trois_cles_refusees_au_plus(call, tavily):
    keys = FakeKeys()
    for key in KEYS:
        tavily.outcomes[key] = RuntimeError(QUOTA_MESSAGE)

    with pytest.raises(QuotaExhaustedError, match="3 clé"):
        call(keys)
    assert keys.exhausted == KEYS[:3]


def test_aucune_cle_disponible_l_erreur_remonte_sans_appel(call, tavily):
    keys = FakeKeys(keys=[])

    with pytest.raises(QuotaExhaustedError):
        call(keys)
    assert tavily.calls == []


# ── Autre panne → TavilyRequestError, la clé n'est pas marquée ───────

def test_une_panne_reseau_est_une_erreur_typee(call, tavily):
    keys = FakeKeys()
    tavily.outcomes[KEYS[0]] = TimeoutError("Read timed out")

    with pytest.raises(TavilyRequestError, match="Read timed out") as error:
        call(keys)

    assert isinstance(error.value.__cause__, TimeoutError)
    assert keys.exhausted == []
    assert keys.usage == []
    assert len(tavily.calls) == 1


# ── search_web : crédits et paramètres ───────────────────────────────

def test_search_web_credits_et_parametres(tavily):
    keys = FakeKeys()

    search_web("Frais EMLV", keys, include_domains=["emlv.fr"], search_depth="advanced")

    [(_key, _method, params)] = tavily.calls
    assert params["include_domains"] == ["emlv.fr"]
    assert params["search_depth"] == "advanced"
    assert keys.usage == [(KEYS[0], 2)]


def test_search_web_sans_resultat_rend_une_chaine_vide(tavily):
    keys = FakeKeys()
    tavily.outcomes[KEYS[0]] = {"results": []}

    assert search_web("Frais EMLV", keys) == ""
    assert keys.usage == [(KEYS[0], 1)]


def test_une_panne_ne_passe_pas_pour_un_quota():
    """Le traitement des contributions arrête le lot sur un quota, et garde le
    ticket en Failed sur une panne : les deux erreurs restent distinctes."""
    assert not issubclass(TavilyRequestError, QuotaExhaustedError)
    assert not issubclass(QuotaExhaustedError, TavilyRequestError)
    assert tavily_client.QUOTA_KEY_ATTEMPTS == 3
