"""
backend/tavily/key_manager.py — TavilyKeyManager (Étape 4.3)

Gestion de la rotation des clés API Tavily avec :
  - Rotation automatique à 950 crédits consommés (seuil sécurisé avant 1000)
  - Tracking des crédits par clé
  - QuotaExhaustedError si toutes les clés sont épuisées
  - Thread-safe (Lock pour les accès concurrents)
  - Reset des compteurs au début de chaque mois

Référence : task.md §4.3, architecture.md §4.3 (TavilyKeyManager)
"""

import os
import time
import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone

logger = logging.getLogger("pipeline.tavily")

CREDIT_ROTATION_THRESHOLD = 950   # Rotation avant d'atteindre 1000 crédits
CREDITS_PER_SEARCH = 1            # 1 crédit par requête de recherche


class QuotaExhaustedError(Exception):
    """Levée quand toutes les clés API Tavily sont épuisées."""
    pass


@dataclass
class TavilyKeyState:
    """État d'une clé API Tavily."""
    api_key: str
    credits_used: int = 0
    exhausted: bool = False
    last_used_at: float = field(default_factory=time.time)
    reset_month: int = field(default_factory=lambda: datetime.now(timezone.utc).month)


class TavilyKeyManager:
    """
    Gestionnaire de rotation des clés API Tavily.

    Charge les clés depuis les variables d'environnement :
    - TAVILY_API_KEY_1, TAVILY_API_KEY_2, ... jusqu'à TAVILY_API_KEY_10

    Usage:
        manager = TavilyKeyManager()
        key = manager.get_active_key()
        manager.record_usage(key, credits=1)

    Référence : architecture.md §4.3 (Tavily key rotation strategy)
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._keys: list[TavilyKeyState] = []
        self._current_index = 0
        self._load_keys()

    def _load_keys(self):
        """Charge les clés depuis les variables d'environnement.

        Supporte deux formats :
        - TAVILY_API_KEYS="key1,key2,key3" (liste séparée par virgules)
        - TAVILY_API_KEY_1, TAVILY_API_KEY_2... (variables numérotées)
        - TAVILY_API_KEY (singulier, fallback)
        """
        keys_found = []

        # Format 1 : TAVILY_API_KEYS="key1,key2,key3"
        keys_str = os.environ.get("TAVILY_API_KEYS", "")
        if keys_str:
            for k in keys_str.split(","):
                k = k.strip()
                if k:
                    keys_found.append(TavilyKeyState(api_key=k))

        # Format 2 : TAVILY_API_KEY_1 ... TAVILY_API_KEY_10
        for i in range(1, 11):
            key = os.environ.get(f"TAVILY_API_KEY_{i}")
            if key and key.strip():
                # Éviter les doublons
                if not any(ks.api_key == key.strip() for ks in keys_found):
                    keys_found.append(TavilyKeyState(api_key=key.strip()))

        # Format 3 : TAVILY_API_KEY (singulier)
        if not keys_found:
            single_key = os.environ.get("TAVILY_API_KEY")
            if single_key and single_key.strip():
                keys_found.append(TavilyKeyState(api_key=single_key.strip()))

        if not keys_found:
            raise RuntimeError(
                "Aucune clé Tavily trouvée. "
                "Définir TAVILY_API_KEYS ou TAVILY_API_KEY_1 dans les variables d'environnement."
            )

        self._keys = keys_found
        logger.info(f"✅ TavilyKeyManager initialisé avec {len(self._keys)} clé(s)")


    def _reset_if_new_month(self, key_state: TavilyKeyState):
        """Remet les compteurs à zéro si on est dans un nouveau mois."""
        current_month = datetime.now(timezone.utc).month
        if key_state.reset_month != current_month:
            logger.info(
                f"🔄 Reset mensuel des crédits pour la clé "
                f"...{key_state.api_key[-6:]} "
                f"(était: {key_state.credits_used} crédits)"
            )
            key_state.credits_used = 0
            key_state.exhausted = False
            key_state.reset_month = current_month

    def get_active_key(self) -> str:
        """
        Retourne la clé API active (avec suffisamment de crédits restants).

        Effectue la rotation si la clé courante dépasse le seuil.
        Lève QuotaExhaustedError si toutes les clés sont épuisées.

        Thread-safe.
        """
        with self._lock:
            # Réinitialisation mensuelle de toutes les clés
            for key_state in self._keys:
                self._reset_if_new_month(key_state)

            # Chercher une clé disponible à partir de l'index courant
            for _ in range(len(self._keys)):
                key_state = self._keys[self._current_index]

                if not key_state.exhausted and key_state.credits_used < CREDIT_ROTATION_THRESHOLD:
                    return key_state.api_key

                # Passer à la clé suivante
                self._current_index = (self._current_index + 1) % len(self._keys)

            # Aucune clé disponible
            total_used = sum(k.credits_used for k in self._keys)
            raise QuotaExhaustedError(
                f"Toutes les clés Tavily sont épuisées "
                f"({len(self._keys)} clé(s), {total_used} crédits totaux utilisés). "
                f"Les crédits se réinitialisent en début de mois."
            )

    def record_usage(self, api_key: str, credits: int = CREDITS_PER_SEARCH):
        """
        Enregistre la consommation de crédits pour une clé.

        Marque la clé comme épuisée si le seuil est atteint.
        Déclenche la rotation vers la prochaine clé disponible.

        Thread-safe.
        """
        with self._lock:
            for key_state in self._keys:
                if key_state.api_key == api_key:
                    key_state.credits_used += credits
                    key_state.last_used_at = time.time()

                    if key_state.credits_used >= CREDIT_ROTATION_THRESHOLD:
                        if not key_state.exhausted:
                            logger.warning(
                                f"⚡ Clé Tavily ...{api_key[-6:]} atteint "
                                f"{key_state.credits_used}/{CREDIT_ROTATION_THRESHOLD} crédits. "
                                f"Rotation vers la clé suivante."
                            )
                            key_state.exhausted = True
                            # Avancer l'index vers la prochaine clé
                            self._current_index = (
                                (self._current_index + 1) % len(self._keys)
                            )
                    break

    def get_status(self) -> list[dict]:
        """Retourne le statut de toutes les clés (pour l'endpoint pipeline-status)."""
        with self._lock:
            return [
                {
                    "key_suffix": f"...{ks.api_key[-6:]}",
                    "credits_used": ks.credits_used,
                    "credits_remaining": max(0, CREDIT_ROTATION_THRESHOLD - ks.credits_used),
                    "exhausted": ks.exhausted,
                    "reset_month": ks.reset_month,
                }
                for ks in self._keys
            ]

    @property
    def total_keys(self) -> int:
        return len(self._keys)

    @property
    def available_keys(self) -> int:
        with self._lock:
            return sum(
                1 for ks in self._keys
                if not ks.exhausted and ks.credits_used < CREDIT_ROTATION_THRESHOLD
            )
