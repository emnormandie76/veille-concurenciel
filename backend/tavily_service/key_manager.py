"""
backend/tavily/key_manager.py — TavilyKeyManager (Étape 4.3)

Gestion de la rotation des clés API Tavily avec :
  - Rotation automatique à 950 crédits consommés (seuil sécurisé avant 1000)
  - Tracking des crédits par clé
  - QuotaExhaustedError si toutes les clés sont épuisées
  - Thread-safe (Lock pour les accès concurrents)
  - Reset des compteurs au début de chaque mois
  - Synchro `/usage` : en arrière-plan au démarrage, ou bloquante
    (`sync_usage`) avant une passe réelle

Référence : task.md §4.3, architecture.md §4.3 (TavilyKeyManager),
docs/features/backend-local.md étape 3 (F8)
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

USAGE_URL = "https://api.tavily.com/usage"
# Délai d'une synchro de toutes les clés (sync_usage), et d'une requête /usage
# d'une clé seule en arrière-plan (_fetch_quota_in_background).
USAGE_SYNC_TIMEOUT_SECONDS = 20.0
USAGE_FETCH_TIMEOUT_SECONDS = 5.0


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


def _key_suffix(api_key: str) -> str:
    """La seule partie d'une clé qui sort du gestionnaire (journaux, statut)."""
    return f"...{api_key[-6:]}"


class TavilyKeyManager:
    """
    Gestionnaire de rotation des clés API Tavily avec suivi de quota dynamique.

    Charge les clés depuis les variables d'environnement et interroge
    périodiquement l'API Tavily pour connaître l'utilisation réelle.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._keys: list[TavilyKeyState] = []
        # Plus de _current_index : la rotation circulaire a laissé place à la
        # sélection de la première clé disponible (get_active_key), qui parcourt
        # la liste à chaque appel. Le compteur ne servait plus à rien.
        self._load_keys()

        # Dernière synchro /usage de toutes les clés : {ok, at, failed_keys}, ou
        # None tant qu'aucune n'est terminée. Voir sync_usage().
        self._last_sync: dict | None = None

        # Synchro initiale des quotas, en arrière-plan : le démarrage n'attend
        # pas Tavily.
        self._sync_usage_in_background()

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

    def _fetch_quota(self, key_state: TavilyKeyState, timeout: float) -> bool:
        """
        Recale le quota d'une clé sur `GET /usage`, en bloquant. Vrai si la
        réponse a été lue et appliquée.

        Code commun au fil d'arrière-plan (_fetch_quota_in_background) et à la
        synchro bloquante (sync_usage). Une réponse sans bloc `key` est un
        échec : elle passait auparavant sans rien dire, et la clé gardait son
        compteur local comme s'il avait été recalé.
        """
        req = urllib.request.Request(
            USAGE_URL,
            headers={
                "Authorization": f"Bearer {key_state.api_key}",
                "User-Agent": "FastAPI-Backend-Agent"
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                if response.status != 200:
                    raise RuntimeError(f"HTTP {response.status}")
                data = json.loads(response.read().decode("utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("key"), dict):
                raise RuntimeError("réponse sans bloc « key »")

            usage = data["key"].get("usage")
            if usage is None:
                usage = 0

            limit = data["key"].get("limit")
            if limit is None:
                if isinstance(data.get("account"), dict):
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
                f"📊 Synchro Quota Tavily ({_key_suffix(key_state.api_key)}) réussie : "
                f"{usage}/{limit} crédits (restant: {limit - usage})"
            )
            return True
        except Exception as e:
            # Réinitialiser pour retenter au prochain cycle si erreur
            with self._lock:
                key_state.last_fetched_at = 0.0
            logger.error(f"❌ Échec de la synchro de quota Tavily ({_key_suffix(key_state.api_key)}) : {e}")
            return False

    def _fetch_quota_in_background(self, key_state: TavilyKeyState):
        """Met à jour le quota de la clé via l'API en arrière-plan (sans bloquer)."""
        # On définit temporairement la date de synchro pour éviter de spawner plusieurs threads
        key_state.last_fetched_at = time.time()
        threading.Thread(
            target=self._fetch_quota,
            args=(key_state, USAGE_FETCH_TIMEOUT_SECONDS),
            daemon=True,
        ).start()

    def sync_usage(self, timeout: float = USAGE_SYNC_TIMEOUT_SECONDS) -> dict:
        """
        Recale toutes les clés sur `GET /usage`, en bloquant au plus `timeout`
        secondes, et mémorise le résultat : `{ok, at, failed_keys}`.

        Les compteurs vivent en mémoire et repartent de zéro à chaque
        démarrage. Une passe réelle appelle cette synchro d'abord, et ne part
        pas si une clé n'a pas pu être recalée : sinon le plafond mensuel
        croirait le mois vierge (F8, backend-local.md).

        Les clés sont interrogées en parallèle. Une clé qui n'a pas répondu
        dans le délai compte comme un échec ; sa requête peut encore aboutir
        plus tard et recaler la clé, sans changer le résultat rendu ici.
        `failed_keys` ne porte que des suffixes (`...abc123`).
        """
        with self._lock:
            keys = list(self._keys)
            started_at = time.time()
            for key_state in keys:
                # Comme _fetch_quota_in_background : get_status() ne relance pas
                # une requête pour une clé en cours de synchro.
                key_state.last_fetched_at = started_at

        results: dict[int, bool] = {}

        def run(index: int, key_state: TavilyKeyState) -> None:
            results[index] = self._fetch_quota(key_state, timeout)

        threads = [
            threading.Thread(target=run, args=(index, key_state), daemon=True)
            for index, key_state in enumerate(keys)
        ]
        for thread in threads:
            thread.start()
        deadline = time.monotonic() + timeout
        for thread in threads:
            thread.join(max(0.0, deadline - time.monotonic()))

        failed = [
            _key_suffix(key_state.api_key)
            for index, key_state in enumerate(keys)
            if not results.get(index)
        ]
        last_sync = {
            "ok": not failed,
            "at": datetime.now(timezone.utc).isoformat(),
            "failed_keys": failed,
        }
        with self._lock:
            self._last_sync = last_sync
        if failed:
            logger.error(
                f"❌ Synchro /usage incomplète : {len(failed)}/{len(keys)} clé(s) "
                f"non recalée(s) ({', '.join(failed)})"
            )
        else:
            logger.info(f"✅ Synchro /usage : {len(keys)} clé(s) recalée(s)")
        return {**last_sync, "failed_keys": list(failed)}

    def _sync_usage_in_background(self) -> None:
        """Lance sync_usage() dans un fil démon : le démarrage n'attend pas Tavily."""
        threading.Thread(target=self.sync_usage, daemon=True).start()

    @property
    def last_sync(self) -> dict | None:
        """La dernière synchro de toutes les clés (`{ok, at, failed_keys}`), ou None."""
        with self._lock:
            if self._last_sync is None:
                return None
            return {**self._last_sync, "failed_keys": list(self._last_sync["failed_keys"])}

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


    def credits_used_this_month(self) -> int:
        """
        Crédits consommés ce mois-ci, toutes clés confondues — le plafond du job
        de rotation se calcule dessus.

        Remet d'abord à zéro, sous le verrou, une clé restée sur le mois
        précédent. `get_status()` ne le fait pas : le 1er du mois, il rend encore
        la consommation du mois écoulé tant qu'aucune clé n'a été demandée.

        Ce sont des ESTIMATIONS (Research ne déclare pas son coût, voir
        ESTIMATED_CREDITS), sur le mois calendaire UTC, qui n'est pas forcément
        le cycle de facturation Tavily : d'où un plafond inférieur au budget.
        """
        with self._lock:
            for key_state in self._keys:
                self._reset_if_new_month(key_state)
            return sum(key_state.credits_used for key_state in self._keys)

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

