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
import json
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone

logger = logging.getLogger("pipeline.tavily")

CREDITS_PER_SEARCH = 1            # 1 crédit par requête de recherche


class QuotaExhaustedError(Exception):
    """Levée quand toutes les clés API Tavily sont épuisées."""
    pass


@dataclass
class TavilyKeyState:
    """État d'une clé API Tavily."""
    api_key: str
    credits_used: int = 0
    credits_limit: int = 1000  # Limite de crédits dynamique, par défaut 1000
    exhausted: bool = False
    last_used_at: float = field(default_factory=time.time)
    reset_month: int = field(default_factory=lambda: datetime.now(timezone.utc).month)
    last_fetched_at: float = 0.0  # Timestamp Unix de la dernière actualisation API


# Fragments de message renvoyes par l API Tavily quand le quota est atteint.
# Etaient definis en local dans research_client.py : client.py ne les connaissait
# pas et n appelait donc jamais mark_exhausted(). Une cle morte restait
# selectionnee et etait reinterrogee en boucle.
QUOTA_ERROR_PHRASES = (
    "exceeds your plan",
    "usage limit",
    "rate limit",
    "quota",
    "upgrade your plan",
)


def is_quota_error(error: Exception) -> bool:
    """Vrai si l exception ressemble a un refus de quota de l API Tavily."""
    message = str(error).lower()
    return any(phrase in message for phrase in QUOTA_ERROR_PHRASES)


class TavilyKeyManager:
    """
    Gestionnaire de rotation des clés API Tavily avec suivi de quota dynamique.

    Charge les clés depuis les variables d'environnement et interroge
    périodiquement l'API Tavily pour connaître l'utilisation réelle.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._keys: list[TavilyKeyState] = []
        self._current_index = 0
        self._load_keys()
        
        # Lancer la synchro initiale des quotas en arrière-plan pour toutes les clés
        for key_state in self._keys:
            self._fetch_quota_in_background(key_state)

    def _load_keys(self):
        """Charge les clés depuis les variables d'environnement."""
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

    def _fetch_quota_in_background(self, key_state: TavilyKeyState):
        """Met à jour le quota de la clé via l'API en arrière-plan (sans bloquer)."""
        # On définit temporairement la date de synchro pour éviter de spawner plusieurs threads
        now = time.time()
        key_state.last_fetched_at = now

        def run():
            url = "https://api.tavily.com/usage"
            req = urllib.request.Request(
                url,
                headers={
                    "Authorization": f"Bearer {key_state.api_key}",
                    "User-Agent": "FastAPI-Backend-Agent"
                }
            )
            try:
                # 5s timeout
                with urllib.request.urlopen(req, timeout=5.0) as response:
                    if response.status == 200:
                        data = json.loads(response.read().decode("utf-8"))
                        if "key" in data:
                            usage = data["key"].get("usage")
                            if usage is None:
                                usage = 0
                            
                            limit = data["key"].get("limit")
                            if limit is None:
                                if "account" in data:
                                    limit = data["account"].get("plan_limit")
                            if limit is None:
                                limit = 1000
                            
                            with self._lock:
                                # max() et non affectation directe : la synchro est declenchee par
                                # mark_exhausted() lui-meme. Une valeur distante en retard ecrasait le
                                # compteur local et rouvrait la cle.
                                key_state.credits_used = max(key_state.credits_used, usage)
                                key_state.credits_limit = limit
                                key_state.last_fetched_at = time.time()

                                # Seuil de securite : rotation s'il reste 10 credits ou moins
                                rotation_threshold = limit - 10
                                if key_state.credits_used >= rotation_threshold:
                                    key_state.exhausted = True
                                # JAMAIS de branche else remettant exhausted a False : c etait la
                                # boucle de sollicitation d une cle refusee par l API. Seul le
                                # passage au mois suivant (_reset_if_new_month) leve le drapeau.
                            
                            logger.info(
                                f"📊 Synchro Quota Tavily (...{key_state.api_key[-6:]}) réussie : "
                                f"{usage}/{limit} crédits (restant: {limit - usage})"
                            )
            except Exception as e:
                # Réinitialiser pour retenter au prochain cycle si erreur
                with self._lock:
                    key_state.last_fetched_at = 0.0
                logger.error(f"❌ Échec de la synchro de quota Tavily (...{key_state.api_key[-6:]}) : {e}")

        threading.Thread(target=run, daemon=True).start()

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
            # Forcer une nouvelle synchro API
            key_state.last_fetched_at = 0.0

    def get_active_key(self, required_credits: int = 50) -> str:
        """
        Retourne la clé API active avec suffisamment de crédits restants pour l'opération demandée.
        Stratégie Greedy : Cherche une clé qui a au moins `required_credits` restants.
        Thread-safe.
        """
        with self._lock:
            for key_state in self._keys:
                self._reset_if_new_month(key_state)

            # Recherche greedy de la première clé disponible ayant assez de crédits
            for key_state in self._keys:
                remaining = key_state.credits_limit - key_state.credits_used
                if not key_state.exhausted and remaining >= 10 and remaining >= required_credits:
                    return key_state.api_key

            total_used = sum(k.credits_used for k in self._keys)
            raise QuotaExhaustedError(
                f"Toutes les clés Tavily sont insuffisantes pour cette opération de {required_credits} crédits "
                f"({len(self._keys)} clé(s), {total_used} crédits totaux utilisés)."
            )

    def record_usage(self, api_key: str, credits: int = CREDITS_PER_SEARCH):
        """Enregistre la consommation de crédits locaux."""
        with self._lock:
            for key_state in self._keys:
                if key_state.api_key == api_key:
                    key_state.credits_used += credits
                    key_state.last_used_at = time.time()

                    # Seuil de sécurité : rotation s'il reste 10 crédits ou moins
                    rotation_threshold = key_state.credits_limit - 10
                    if key_state.credits_used >= rotation_threshold:
                        if not key_state.exhausted:
                            logger.warning(
                                f"⚡ Clé Tavily ...{api_key[-6:]} atteint "
                                f"{key_state.credits_used}/{rotation_threshold} crédits. "
                                f"Marquée comme épuisée."
                            )
                            key_state.exhausted = True
                    break

    def mark_exhausted(self, api_key: str):
        """
        Force le marquage d'une clé comme épuisée.
        Appelé quand l'API Tavily retourne une erreur de quota (ex: 402, 429)
        même si le tracker local n'avait pas détecté l'épuisement.
        Déclenche aussi une synchro de quota en arrière-plan pour mettre à jour les crédits réels.
        """
        with self._lock:
            for key_state in self._keys:
                if key_state.api_key == api_key:
                    if not key_state.exhausted:
                        logger.warning(
                            f"🚫 Clé Tavily ...{api_key[-6:]} forcée comme épuisée "
                            f"(quota API atteint — synchro en cours)"
                        )
                        key_state.exhausted = True
                    # Forcer une resynchronisation du quota réel en arrière-plan
                    key_state.last_fetched_at = 0.0
                    self._fetch_quota_in_background(key_state)
                    break


    def get_status(self) -> list[dict]:
        """Retourne le statut de toutes les clés (déclenche une synchro asynchrone si cache > 5 min)."""
        now = time.time()
        with self._lock:
            for ks in self._keys:
                # Si le cache a plus de 5 minutes (300 secondes), relancer une mise à jour en tâche de fond
                if now - ks.last_fetched_at > 300:
                    self._fetch_quota_in_background(ks)

            return [
                {
                    "key_suffix": f"...{ks.api_key[-6:]}",
                    "credits_used": ks.credits_used,
                    "credits_limit": ks.credits_limit,
                    "credits_remaining": max(0, ks.credits_limit - ks.credits_used),
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
                if not ks.exhausted and ks.credits_used < (ks.credits_limit - 10)
            )

