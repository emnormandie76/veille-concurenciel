"""
La cascade Gemini, parcourue par le bas (`lowest_first`), et le délai avant
qu'un modèle rouvre (`seconds_until_available`).

Tâche hors plan C1 à C4 : le crowdsourcing passe par la cascade du pipeline. Sa
vérification de compatibilité ne rend qu'un booléen : elle part des modèles
« lite » pour ménager les quotas rares des paliers hauts. Le comportement du
pipeline ne change pas (test/test_gemini_cascade.py, resté tel quel) : le
défaut est toujours du plus fort au plus faible.

Ni réseau ni quota : le client est une doublure, comme dans test_gemini_cascade.py.
"""

import time
from unittest.mock import patch

import pytest

from backend.ai import gemini_client as gc
from backend.ai.gemini_client import ExtractionUnavailable, ModelRegistry

LADDER = [
    ("models/high-a", "high"),
    ("models/mid-a", "mid"),
    ("models/low-a", "low"),
    ("models/low-b", "low"),
]

SCHEMA = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}


class _Candidate:
    finish_reason = type("FinishReason", (), {"name": "STOP"})()


class _Response:
    def __init__(self, text):
        self.text = text
        self.candidates = [_Candidate()]


class _Client:
    """Répond `{"ok": true}` ; un modèle listé dans `failing` lève un 503."""

    def __init__(self, failing=()):
        self.calls = []
        self.failing = set(failing)
        outer = self

        class Models:
            def generate_content(self, model, contents, config):
                outer.calls.append(model)
                if model in outer.failing:
                    error = Exception("503 UNAVAILABLE")
                    error.code = 503
                    raise error
                return _Response('{"ok": true}')

        self.models = Models()


@pytest.fixture(autouse=True)
def _no_gate(monkeypatch):
    monkeypatch.setattr(gc, "_wait_for_slot", lambda: None)


def _extract(client, registry, **kwargs):
    with patch.object(gc, "get_client", return_value=client):
        return gc.extract_structured("prompt", "texte", SCHEMA, registry=registry, **kwargs)


def test_par_defaut_la_cascade_part_du_haut():
    client = _Client()
    _extract(client, ModelRegistry(ladder=LADDER))
    assert client.calls == ["models/high-a"]


def test_lowest_first_part_du_plus_faible():
    client = _Client()
    _extract(client, ModelRegistry(ladder=LADDER), lowest_first=True)
    assert client.calls == ["models/low-b"]


def test_lowest_first_monte_quand_le_bas_est_epuise():
    client = _Client(failing={"models/low-b", "models/low-a"})
    _extract(client, ModelRegistry(ladder=LADDER), lowest_first=True)
    assert client.calls == ["models/low-b", "models/low-a", "models/mid-a"]


def test_lowest_first_respecte_toujours_le_plancher():
    registry = ModelRegistry(ladder=LADDER)
    assert [s.model_id for s in registry.candidates("mid", lowest_first=True)] == [
        "models/mid-a", "models/high-a",
    ]
    assert [s.model_id for s in registry.candidates("mid")] == ["models/high-a", "models/mid-a"]


def test_lowest_first_epuise_leve_extraction_unavailable():
    client = _Client(failing={m for m, _ in LADDER})
    with pytest.raises(ExtractionUnavailable):
        _extract(client, ModelRegistry(ladder=LADDER), lowest_first=True)
    assert client.calls == ["models/low-b", "models/low-a", "models/mid-a", "models/high-a"]


# ── seconds_until_available ──────────────────────────────────────────


def test_delai_nul_quand_un_modele_est_disponible():
    assert ModelRegistry(ladder=LADDER).seconds_until_available("low") == 0.0


def test_delai_jusqu_a_la_premiere_reouverture():
    registry = ModelRegistry(ladder=LADDER)
    registry.cool_down("models/low-a", 600, "429 quota")
    registry.cool_down("models/low-b", 120, "503")
    registry.cool_down("models/mid-a", 3000, "429 quota")
    registry.cool_down("models/high-a", 9000, "429 quota")

    # Le plus tôt rouvert au-dessus du plancher, pas le plus tardif.
    assert registry.seconds_until_available("low") == pytest.approx(120, abs=2)
    # Plancher « mid » : low-b ne compte pas.
    assert registry.seconds_until_available("mid") == pytest.approx(3000, abs=2)


def test_un_modele_desactive_ne_rouvre_jamais():
    registry = ModelRegistry(ladder=LADDER)
    for model_id, _ in LADDER:
        registry.disable(model_id, "429 limit:0")
    assert registry.seconds_until_available("low") is None


def test_un_cooldown_expire_ne_compte_plus():
    registry = ModelRegistry(ladder=LADDER)
    registry.cool_down("models/low-a", 1, "503")
    with patch.object(time, "time", return_value=time.time() + 5):
        assert registry.seconds_until_available("low") == 0.0
