"""
La passe catalogue de la Phase 1 (backend/tavily_service/catalog_client.py).

L'ancrage catalogue est un bonus, jamais une dépendance dure : aucune fonction
ne lève, et la Phase 1 continue sans lui. Plan backend-local, étape 7 (P1) :
quota → passe abandonnée avec un avertissement ; page introuvable → ancre
vide (`fetch_catalog` rend None, et le prompt de la Phase 1 reste inchangé).

Ni réseau ni clé réelle : `TavilyClient` est remplacé dans le module.
"""

import logging

import pytest

from backend.ai.extraction_prompts import get_extraction_prompt, with_catalog_anchor
from backend.tavily_service import catalog_client
from backend.tavily_service.catalog_client import fetch_catalog, find_catalog_pages
from backend.tavily_service.key_manager import QuotaExhaustedError

KEY_A, KEY_B = "tvly-test-aaaaaa", "tvly-test-bbbbbb"
DOMAIN = "www.em-normandie.com"
CATALOG = "https://www.em-normandie.com/fr/programmes"


class FakeKeys:
    def __init__(self, keys=(KEY_A, KEY_B)):
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
    def __init__(self):
        self.search_results = []     # une réponse par appel, la dernière se répète
        self.search_errors = {}      # clé → exception
        self.extract_result = {"results": [{"url": CATALOG, "raw_content": "- Programme Grande École\n- Bachelor"}],
                               "usage": {"credits": 1}}
        self.calls = []

    def factory(self, api_key):
        tavily = self

        class Client:
            def search(self, **params):
                tavily.calls.append(("search", api_key, params))
                if api_key in tavily.search_errors:
                    raise tavily.search_errors[api_key]
                index = min(len([c for c in tavily.calls if c[0] == "search"]) - 1,
                            len(tavily.search_results) - 1)
                return tavily.search_results[index] if tavily.search_results else {"results": []}

            def extract(self, **params):
                tavily.calls.append(("extract", api_key, params))
                if isinstance(tavily.extract_result, Exception):
                    raise tavily.extract_result
                return tavily.extract_result

        return Client()


@pytest.fixture
def tavily(monkeypatch):
    fake = Tavily()
    monkeypatch.setattr(catalog_client, "TavilyClient", lambda api_key: fake.factory(api_key))
    return fake


def _hit(url, title="", ):
    return {"url": url, "title": title}


def _searches(tavily):
    return [c for c in tavily.calls if c[0] == "search"]


# ── Page trouvée ─────────────────────────────────────────────────────

def test_une_page_d_index_franche_arrete_la_recherche(tavily):
    keys = FakeKeys()
    tavily.search_results = [{
        "results": [
            _hit("https://www.em-normandie.com/fr/programmes/pge/admissions", "PGE — admissions"),
            _hit(CATALOG, "Nos programmes"),
            _hit("https://evil-em-normandie.com/programmes", "Programmes"),
        ],
        "usage": {"credits": 1},
    }]

    result = fetch_catalog("EM Normandie", DOMAIN, keys)

    assert result is not None
    assert result.urls[0] == CATALOG
    assert "https://evil-em-normandie.com/programmes" not in result.urls
    assert "Programme Grande École" in result.content
    assert len(_searches(tavily)) == 1  # une seule requête payée
    assert result.credits_used == 2     # 1 search + 1 extract, lus dans `usage`


# ── Page introuvable : ancre vide ────────────────────────────────────

def test_page_introuvable_ancre_vide(tavily, caplog):
    keys = FakeKeys()
    tavily.search_results = [{"results": [_hit("https://www.letudiant.fr/em-normandie", "EM Normandie")]}]

    with caplog.at_level(logging.INFO, logger="pipeline.catalog"):
        assert fetch_catalog("EM Normandie", DOMAIN, keys) is None

    assert len(_searches(tavily)) == 3  # les trois requêtes, faute de candidate
    assert [c for c in tavily.calls if c[0] == "extract"] == []
    assert any("Aucune page catalogue" in r.getMessage() for r in caplog.records)
    # Sans catalogue, le prompt de la Phase 1 est rendu inchangé.
    prompt = get_extraction_prompt("Program_Discovery")
    assert with_catalog_anchor(prompt, []) == prompt


def test_pages_trouvees_mais_vides_ancre_vide(tavily):
    keys = FakeKeys()
    tavily.search_results = [{"results": [_hit(CATALOG, "Nos programmes")]}]
    tavily.extract_result = {"results": [{"url": CATALOG, "raw_content": "   "}]}

    assert fetch_catalog("EM Normandie", DOMAIN, keys) is None


# ── Quota : passe abandonnée, avec un avertissement, sans lever ──────

def test_quota_avant_la_recherche_passe_abandonnee(tavily, caplog):
    keys = FakeKeys(keys=())

    with caplog.at_level(logging.WARNING, logger="pipeline.catalog"):
        assert fetch_catalog("EM Normandie", DOMAIN, keys) is None

    assert tavily.calls == []
    assert any("ancrage abandonné" in r.getMessage() for r in caplog.records)


def test_quota_avant_l_extraction_passe_abandonnee(tavily, caplog, monkeypatch):
    keys = FakeKeys()
    tavily.search_results = [{"results": [_hit(CATALOG, "Nos programmes")]}]
    real_get = keys.get_active_key
    calls = []

    def get_active_key(required_credits=50):
        calls.append(required_credits)
        if len(calls) > 1:
            raise QuotaExhaustedError("plus de crédits")
        return real_get(required_credits)

    keys.get_active_key = get_active_key

    with caplog.at_level(logging.WARNING, logger="pipeline.catalog"):
        assert fetch_catalog("EM Normandie", DOMAIN, keys) is None
    assert any("/extract catalogue" in r.getMessage() for r in caplog.records)


def test_refus_de_quota_de_l_api_cle_marquee_et_requete_suivante(tavily):
    keys = FakeKeys()
    tavily.search_errors[KEY_A] = RuntimeError("This request exceeds your plan's set usage limit")
    tavily.search_results = [{"results": [_hit(CATALOG, "Nos programmes")]}]

    urls, _credits = find_catalog_pages("EM Normandie", DOMAIN, keys)

    assert keys.exhausted == [KEY_A]
    assert urls == [CATALOG]
    assert [c[1] for c in _searches(tavily)] == [KEY_A, KEY_B]


def test_une_erreur_imprevue_ne_fait_jamais_echouer_la_phase_1(tavily, caplog):
    keys = FakeKeys()
    tavily.search_results = [{"results": [_hit(CATALOG, "Nos programmes")]}]

    def explode(api_key, credits=1):
        raise QuotaExhaustedError("compteur plein")

    keys.record_usage = explode

    with caplog.at_level(logging.WARNING, logger="pipeline.catalog"):
        assert fetch_catalog("EM Normandie", DOMAIN, keys) is None
    assert any("Quota Tavily épuisé pendant la passe catalogue" in r.getMessage() for r in caplog.records)


def test_l_extraction_en_panne_ancre_vide(tavily):
    keys = FakeKeys()
    tavily.search_results = [{"results": [_hit(CATALOG, "Nos programmes")]}]
    tavily.extract_result = TimeoutError("Read timed out")

    assert fetch_catalog("EM Normandie", DOMAIN, keys) is None
    assert keys.exhausted == []
