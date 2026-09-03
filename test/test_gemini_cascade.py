"""
test/test_gemini_cascade.py — Cascade de modèles Gemini (backend/ai/gemini_client.py)

Ces tests simulent les refus de l'API : aucun appel réseau, aucun quota
consommé. C'est indispensable ici — la clé du projet plafonne à 20 requêtes par
jour sur les modèles de tête, et un test qui brûle du quota ne se relance pas.

Ce qui est vérifié, dans l'ordre du critère d'acceptation :
  - 429 avec « limit: 0 » désactive un modèle pour toute la session ;
  - 429 avec un délai annoncé refroidit de cette durée exactement ;
  - 503 refroidit brièvement et laisse passer au modèle suivant ;
  - l'épuisement sous le plancher de qualité lève ExtractionUnavailable ;
  - une liste JSON n'est JAMAIS réduite à son premier élément.
"""

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.ai import gemini_client as gc  # noqa: E402
from backend.ai.gemini_client import (  # noqa: E402
    ExtractionUnavailable,
    GeminiError,
    ModelRegistry,
    parse_quota_error,
)


# ── Doublures ─────────────────────────────────────────────────────

class FakeAPIError(Exception):
    """Imite google.genai.errors.ClientError : le code vit dans `.code`."""

    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class FakeCandidate:
    def __init__(self, finish_reason: str = "STOP"):
        self.finish_reason = type("FinishReason", (), {"name": finish_reason})()


class FakeResponse:
    def __init__(self, text: str, finish_reason: str = "STOP"):
        self.text = text
        self.candidates = [FakeCandidate(finish_reason)]


class FakeModels:
    """
    Répond selon un scénario {model_id: réponse ou exception}.

    Une entrée absente du scénario lève AssertionError : un test qui interroge
    un modèle qu'il n'a pas prévu doit échouer bruyamment, pas se rabattre en
    silence.
    """

    def __init__(self, scenario: dict):
        self.scenario = scenario
        self.calls: list[str] = []

    def generate_content(self, model, contents, config):
        self.calls.append(model)
        if model not in self.scenario:
            raise AssertionError(f"Modèle non prévu par le scénario : {model}")
        outcome = self.scenario[model]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class FakeClient:
    def __init__(self, scenario: dict):
        self.models = FakeModels(scenario)


# Échelle réduite : trois modèles, trois paliers. Les tests portent sur la
# mécanique de descente, pas sur la liste réelle des modèles — qui bougera.
TEST_LADDER = [
    ("models/high-a", "high"),
    ("models/mid-a", "mid"),
    ("models/low-a", "low"),
]

MINIMAL_SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": {"type": "object"}}},
    "required": ["items"],
}


class GeminiCascadeTestCase(unittest.TestCase):
    def setUp(self):
        # Le portillon RPM espace les appels de 12 s en production : les tests
        # n'ont rien à en attendre.
        self.gate_patcher = patch.object(gc, "_wait_for_slot", lambda: None)
        self.gate_patcher.start()
        self.registry = ModelRegistry(ladder=TEST_LADDER)

    def tearDown(self):
        self.gate_patcher.stop()

    def _extract(self, scenario: dict, min_tier: str = "low"):
        client = FakeClient(scenario)
        with patch.object(gc, "get_client", return_value=client):
            result = gc.extract_structured(
                system_prompt="prompt",
                source_text="texte",
                json_schema=MINIMAL_SCHEMA,
                min_tier=min_tier,
                registry=self.registry,
            )
        return result, client.models.calls


# ── Lecture des refus 429 ─────────────────────────────────────────

class TestParseQuotaError(unittest.TestCase):
    def test_limit_zero_is_permanent(self):
        """
        « limit: 0 » veut dire que le modèle n'est pas ouvert au free tier sur
        cette clé. C'est le test qui évite de retenter en boucle un modèle hors
        d'atteinte : aucun délai ne le rendra disponible.
        """
        message = (
            "You exceeded your current quota. * Quota exceeded for metric: "
            "generativelanguage.googleapis.com/generate_content_free_tier_requests, "
            "limit: 0, model: gemini-3.1-pro Please retry in 3.481302195s."
        )
        verdict = parse_quota_error(message)
        self.assertTrue(verdict.permanent)

    def test_retry_delay_is_read_not_invented(self):
        """« Please retry in Xs » donne la durée de refroidissement à respecter."""
        message = (
            "Quota exceeded for metric: generate_content_free_tier_requests, "
            "limit: 5, model: gemini-3.7-flash. Please retry in 27.5s."
        )
        verdict = parse_quota_error(message)
        self.assertFalse(verdict.permanent)
        self.assertAlmostEqual(verdict.cooldown_seconds, 27.5, places=3)

    def test_daily_quota_waits_for_pacific_midnight(self):
        """
        Un quota journalier ne se rouvre pas en quelques secondes. Le nom de la
        métrique est le seul indice : on refroidit jusqu'à minuit Pacifique.
        """
        message = (
            "Quota exceeded for quota metric "
            "generate_requests_per_model_per_day, limit: 20. Please retry in 30s."
        )
        verdict = parse_quota_error(message)
        self.assertFalse(verdict.permanent)
        self.assertGreater(verdict.cooldown_seconds, 3600)

    def test_unreadable_message_falls_back_to_default(self):
        verdict = parse_quota_error("RESOURCE_EXHAUSTED")
        self.assertFalse(verdict.permanent)
        self.assertEqual(
            verdict.cooldown_seconds, gc.DEFAULT_QUOTA_COOLDOWN_SECONDS
        )


# ── Descente de l'échelle ─────────────────────────────────────────

class TestCascade(GeminiCascadeTestCase):
    def test_first_available_model_wins(self):
        """Sans refus, on ne descend pas : le plus apte répond, on s'arrête là."""
        result, calls = self._extract(
            {"models/high-a": FakeResponse('{"items": [{"a": 1}]}')}
        )
        self.assertEqual(result, {"items": [{"a": 1}]})
        self.assertEqual(calls, ["models/high-a"])

    def test_429_limit_zero_disables_model_for_the_session(self):
        """
        Le critère d'acceptation central : un modèle marqué limit:0 n'est plus
        JAMAIS interrogé de la session. FakeModels lève si un modèle hors
        scénario est appelé — la seconde extraction ne prévoit pas high-a.
        """
        limit_zero = FakeAPIError(
            429,
            "Quota exceeded for metric: generate_content_free_tier_requests, "
            "limit: 0, model: high-a",
        )
        result, calls = self._extract(
            {
                "models/high-a": limit_zero,
                "models/mid-a": FakeResponse('{"items": []}'),
            }
        )
        self.assertEqual(calls, ["models/high-a", "models/mid-a"])
        self.assertEqual(result, {"items": []})

        snapshot = {row["model"]: row for row in self.registry.snapshot()}
        self.assertTrue(snapshot["models/high-a"]["disabled"])

        # Seconde extraction : high-a n'est même plus proposé.
        _, calls2 = self._extract({"models/mid-a": FakeResponse('{"items": []}')})
        self.assertEqual(calls2, ["models/mid-a"])

    def test_429_with_delay_cools_down_without_disabling(self):
        """Un quota RPM épuisé n'est pas un modèle mort : on le refroidit, on n'y touche plus."""
        rate_limited = FakeAPIError(
            429,
            "Quota exceeded for metric: generate_content_free_tier_requests, "
            "limit: 5, model: high-a. Please retry in 42s.",
        )
        _, calls = self._extract(
            {
                "models/high-a": rate_limited,
                "models/mid-a": FakeResponse('{"items": []}'),
            }
        )
        self.assertEqual(calls, ["models/high-a", "models/mid-a"])

        snapshot = {row["model"]: row for row in self.registry.snapshot()}
        self.assertFalse(snapshot["models/high-a"]["disabled"])
        self.assertGreater(snapshot["models/high-a"]["cooling_for"], 30)
        self.assertLessEqual(snapshot["models/high-a"]["cooling_for"], 42)

    def test_503_moves_on_and_cools_briefly(self):
        """
        503 = surcharge passagère, pas un quota. Refroidissement court, pas de
        déclassement durable : quatre des neuf modèles du run de mesure ont
        répondu 503 puis fonctionné en séquentiel.
        """
        unavailable = FakeAPIError(503, "The model is overloaded. UNAVAILABLE")
        _, calls = self._extract(
            {
                "models/high-a": unavailable,
                "models/mid-a": FakeResponse('{"items": []}'),
            }
        )
        self.assertEqual(calls, ["models/high-a", "models/mid-a"])

        snapshot = {row["model"]: row for row in self.registry.snapshot()}
        self.assertFalse(snapshot["models/high-a"]["disabled"])
        self.assertGreater(snapshot["models/high-a"]["cooling_for"], 0)
        self.assertLessEqual(
            snapshot["models/high-a"]["cooling_for"], gc.UNAVAILABLE_COOLDOWN_SECONDS
        )

    def test_timeout_moves_to_next_model(self):
        """504 / DEADLINE_EXCEEDED : modèle trop lent, au suivant immédiatement."""
        timeout = FakeAPIError(504, "504 DEADLINE_EXCEEDED")
        _, calls = self._extract(
            {
                "models/high-a": timeout,
                "models/mid-a": FakeResponse('{"items": []}'),
            }
        )
        self.assertEqual(calls, ["models/high-a", "models/mid-a"])

    def test_min_tier_floor_is_respected(self):
        """
        Le plancher de qualité n'est pas indicatif. Une catégorie qui exige
        'high' ne doit pas se rabattre en silence sur un flash-lite : mieux vaut
        pas de ticket qu'un ticket bas de gamme, le prochain cycle réessaiera.
        """
        limit_zero = FakeAPIError(429, "quota exceeded, limit: 0, model: high-a")
        client = FakeClient({"models/high-a": limit_zero})
        with patch.object(gc, "get_client", return_value=client):
            with self.assertRaises(ExtractionUnavailable):
                gc.extract_structured(
                    system_prompt="prompt",
                    source_text="texte",
                    json_schema=MINIMAL_SCHEMA,
                    min_tier="high",
                    registry=self.registry,
                )
        # mid-a et low-a existent et sont sains : ils n'ont pas été sollicités.
        self.assertEqual(client.models.calls, ["models/high-a"])

    def test_ladder_exhausted_raises_extraction_unavailable(self):
        fail = lambda: FakeAPIError(503, "UNAVAILABLE")  # noqa: E731
        client = FakeClient(
            {
                "models/high-a": fail(),
                "models/mid-a": fail(),
                "models/low-a": fail(),
            }
        )
        with patch.object(gc, "get_client", return_value=client):
            with self.assertRaises(ExtractionUnavailable):
                gc.extract_structured(
                    system_prompt="prompt",
                    source_text="texte",
                    json_schema=MINIMAL_SCHEMA,
                    min_tier="low",
                    registry=self.registry,
                )
        self.assertEqual(len(client.models.calls), 3)

    def test_permanent_client_error_stops_the_cascade(self):
        """
        400 / 401 / 403 : requête ou clé invalide. Descendre l'échelle ne
        corrigerait rien et rejouerait huit fois la même erreur.
        """
        bad_request = FakeAPIError(400, "INVALID_ARGUMENT: schéma invalide")
        client = FakeClient({"models/high-a": bad_request})
        with patch.object(gc, "get_client", return_value=client):
            with self.assertRaises(GeminiError) as ctx:
                gc.extract_structured(
                    system_prompt="prompt",
                    source_text="texte",
                    json_schema=MINIMAL_SCHEMA,
                    registry=self.registry,
                )
        self.assertNotIsInstance(ctx.exception, ExtractionUnavailable)
        self.assertEqual(client.models.calls, ["models/high-a"])


# ── Décodage de la réponse ────────────────────────────────────────

class TestResponseDecoding(GeminiCascadeTestCase):
    def test_array_is_never_flattened(self):
        """
        gemma_client réduisait une liste JSON à son premier élément avec un
        simple warning. Sur dix classements, c'est neuf perdus en silence. Ici
        un tableau reste un tableau.
        """
        payload = '{"items": [{"n": 1}, {"n": 2}, {"n": 3}]}'
        result, _ = self._extract({"models/high-a": FakeResponse(payload)})
        self.assertEqual(len(result["items"]), 3)

    def test_top_level_array_survives(self):
        """Même un tableau racine passe intact, sans être ramené à son premier objet."""
        result, _ = self._extract({"models/high-a": FakeResponse('[{"n": 1}, {"n": 2}]')})
        self.assertEqual(result, [{"n": 1}, {"n": 2}])

    def test_none_text_does_not_raise_typeerror(self):
        """
        `response.text` vaut None quand le modèle ne renvoie aucune part
        textuelle. `len(None)` lève, et la garde censée absorber une réponse
        vide était précisément ce qui cassait dans gemma_client.
        """
        empty = FakeResponse("")
        empty.text = None
        _, calls = self._extract(
            {
                "models/high-a": empty,
                "models/mid-a": FakeResponse('{"items": []}'),
            }
        )
        self.assertEqual(calls, ["models/high-a", "models/mid-a"])

    def test_truncated_response_moves_to_next_model(self):
        truncated = FakeResponse('{"items": [{"n"', finish_reason="MAX_TOKENS")
        _, calls = self._extract(
            {
                "models/high-a": truncated,
                "models/mid-a": FakeResponse('{"items": []}'),
            }
        )
        self.assertEqual(calls, ["models/high-a", "models/mid-a"])


# ── Registre ──────────────────────────────────────────────────────

class TestRegistry(unittest.TestCase):
    def setUp(self):
        self.registry = ModelRegistry(ladder=TEST_LADDER)

    def test_candidates_are_ordered_most_capable_first(self):
        ids = [state.model_id for state in self.registry.candidates()]
        self.assertEqual(ids, ["models/high-a", "models/mid-a", "models/low-a"])

    def test_min_tier_filters_the_ladder(self):
        ids = [state.model_id for state in self.registry.candidates(min_tier="mid")]
        self.assertEqual(ids, ["models/high-a", "models/mid-a"])

    def test_cooldown_never_shortens(self):
        """
        Un refroidissement long ne doit pas être écrasé par un court : c'est la
        variante locale du bug déjà corrigé dans key_manager, où une valeur en
        retard rouvrait une clé épuisée.
        """
        self.registry.cool_down("models/high-a", 600, "RPD")
        self.registry.cool_down("models/high-a", 5, "RPM")
        snapshot = {row["model"]: row for row in self.registry.snapshot()}
        self.assertGreater(snapshot["models/high-a"]["cooling_for"], 100)

    def test_daily_counter_tracks_successes(self):
        """
        Faute d'endpoint de quota, ce compteur est ce qui s'en rapproche le
        plus : il évite de dépenser un appel pour découvrir un mur connu.
        """
        self.registry.record_success("models/high-a")
        self.registry.record_success("models/high-a")
        snapshot = {row["model"]: row for row in self.registry.snapshot()}
        self.assertEqual(snapshot["models/high-a"]["requests_today"], 2)

    def test_daily_counter_resets_on_new_pacific_day(self):
        self.registry.record_success("models/high-a")
        with patch.object(gc, "_pacific_day_key", return_value="2099-01-01"):
            snapshot = {row["model"]: row for row in self.registry.snapshot()}
            self.assertEqual(snapshot["models/high-a"]["requests_today"], 0)

    def test_disabled_model_is_never_a_candidate(self):
        self.registry.disable("models/high-a", "429 limit:0")
        ids = [state.model_id for state in self.registry.candidates()]
        self.assertNotIn("models/high-a", ids)


if __name__ == "__main__":
    unittest.main()
