import unittest
from datetime import datetime, timezone
from unittest.mock import patch
import os
import sys

# Ce fichier vivait a la racine de backend/, au milieu des modules de
# production, et importait `tavily_service.key_manager` : il ne fonctionnait
# qu'execute depuis backend/, et pytest (testpaths = test) ne le collectait
# jamais. Il rejoint la suite, avec l'import absolu que la suite utilise.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.tavily_service.key_manager import (  # noqa: E402
    TavilyKeyManager,
    TavilyKeyState,
    QuotaExhaustedError,
)


class TestTavilyKeyRotation(unittest.TestCase):
    def setUp(self):
        # Configurer de fausses variables d'environnement pour charger 3 clés
        self.env_patcher = patch.dict(os.environ, {
            "TAVILY_API_KEYS": "mock_key_1,mock_key_2,mock_key_3"
        })
        self.env_patcher.start()

        # Patcher _fetch_quota_in_background pour éviter les requêtes HTTP réelles
        self.fetch_patcher = patch.object(TavilyKeyManager, '_fetch_quota_in_background')
        self.mock_fetch = self.fetch_patcher.start()

        # Initialiser le gestionnaire
        self.manager = TavilyKeyManager()

    def tearDown(self):
        self.env_patcher.stop()
        self.fetch_patcher.stop()

    def test_greedy_selection_pro_ignores_low_credits(self):
        """
        Test Mode Pro (250 crédits requis) :
        Vérifier que si la clé 1 n'a plus que 150 crédits restants, elle est ignorée
        au profit de la clé 2 qui a par exemple 500 crédits restants.
        """
        # Clé 1 : 150 crédits restants (limite 1000, 850 utilisés)
        self.manager._keys[0].credits_limit = 1000
        self.manager._keys[0].credits_used = 850
        self.manager._keys[0].exhausted = False

        # Clé 2 : 500 crédits restants (limite 1000, 500 utilisés)
        self.manager._keys[1].credits_limit = 1000
        self.manager._keys[1].credits_used = 500
        self.manager._keys[1].exhausted = False

        # Clé 3 : 1000 crédits restants (limite 1000, 0 utilisé)
        self.manager._keys[2].credits_limit = 1000
        self.manager._keys[2].credits_used = 0
        self.manager._keys[2].exhausted = False

        # Demande pro (250 crédits requis)
        active_key = self.manager.get_active_key(required_credits=250)
        # Devrait retourner la clé 2 car la clé 1 n'a que 150 crédits restants
        self.assertEqual(active_key, "mock_key_2")

    def test_greedy_selection_mini_drains_remaining_credits(self):
        """
        Test Mode Mini (50 crédits requis) :
        Vérifier que si une requête "mini" est lancée, l'algorithme retourne vers la clé 1
        (qui a 150 crédits restants) pour utiliser ses crédits restants au lieu de la clé 2.
        """
        # Configuration identique au test précédent
        self.manager._keys[0].credits_limit = 1000
        self.manager._keys[0].credits_used = 850
        self.manager._keys[0].exhausted = False

        self.manager._keys[1].credits_limit = 1000
        self.manager._keys[1].credits_used = 500
        self.manager._keys[1].exhausted = False

        # Demande mini (50 crédits requis)
        active_key = self.manager.get_active_key(required_credits=50)
        # Devrait retourner la clé 1 car 150 >= 50 et clé 1 est la première dans la liste
        self.assertEqual(active_key, "mock_key_1")

    def test_key_exhausted_under_10_credits(self):
        """
        Test d'épuisement (Exhaustion) :
        Vérifier que si la clé a moins de 10 crédits restants, elle est considérée comme épuisée
        et non sélectionnable.
        """
        # Clé 1 : 9 crédits restants (991 utilisés, limite 1000)
        self.manager._keys[0].credits_limit = 1000
        self.manager._keys[0].credits_used = 991
        self.manager._keys[0].exhausted = False

        # Clé 2 : 8 crédits restants (992 utilisés, limite 1000)
        self.manager._keys[1].credits_limit = 1000
        self.manager._keys[1].credits_used = 992
        self.manager._keys[1].exhausted = False

        # Clé 3 : 5 crédits restants (995 utilisés, limite 1000)
        self.manager._keys[2].credits_limit = 1000
        self.manager._keys[2].credits_used = 995
        self.manager._keys[2].exhausted = False

        # Même une requête de 5 crédits devrait lever QuotaExhaustedError car aucune clé n'a >= 10 crédits
        with self.assertRaises(QuotaExhaustedError):
            self.manager.get_active_key(required_credits=5)

    def test_record_usage_marks_exhausted(self):
        """
        Vérifier que record_usage met correctement à jour les crédits et marque la clé
        comme épuisée si elle passe sous le seuil de 10 crédits restants.
        """
        # Clé 1 : 15 crédits restants
        self.manager._keys[0].credits_limit = 1000
        self.manager._keys[0].credits_used = 985
        self.manager._keys[0].exhausted = False

        # Consommer 10 crédits (il reste 5)
        self.manager.record_usage("mock_key_1", credits=10)

        # Vérifier que les crédits ont augmenté et qu'elle est maintenant épuisée
        self.assertEqual(self.manager._keys[0].credits_used, 995)
        self.assertTrue(self.manager._keys[0].exhausted)

        # Vérifier que get_active_key l'ignore désormais
        self.assertEqual(self.manager.get_active_key(required_credits=5), "mock_key_2")

    def test_credits_used_this_month_remet_a_zero_une_cle_du_mois_precedent(self):
        """
        Le plafond du job de rotation se calcule sur ce total. Le 1er du mois,
        get_status() rend encore la consommation du mois écoulé tant qu'aucune
        clé n'a été demandée : il ne doit pas servir au plafond.
        """
        current = datetime.now(timezone.utc).month
        previous = 12 if current == 1 else current - 1
        self.manager._keys[0].credits_used = 900
        self.manager._keys[0].reset_month = previous
        self.manager._keys[0].exhausted = True
        self.manager._keys[1].credits_used = 120
        self.manager._keys[2].credits_used = 30

        self.assertEqual(sum(k["credits_used"] for k in self.manager.get_status()), 1050)
        self.assertEqual(self.manager.credits_used_this_month(), 150)
        self.assertEqual(self.manager._keys[0].credits_used, 0)
        self.assertFalse(self.manager._keys[0].exhausted)
        self.assertEqual(self.manager._keys[0].reset_month, current)


if __name__ == "__main__":
    unittest.main()
