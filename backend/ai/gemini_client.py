"""
backend/ai/gemini_client.py — Couche d'extraction structurée (Gemini)

Ce module remplace Gemma pour l'extraction du pipeline de recherche. La
différence est structurelle, pas cosmétique : Gemini accepte
`response_json_schema` et `response_mime_type="application/json"`, ce qui fait
de la structure attendue une garantie de décodage plutôt qu'une supplique dans
un prompt. Plus de nettoyage de balises Markdown, plus de retry sur JSON
malformé, plus de validation structurelle a posteriori.

Gemma reste en place pour le crowdsourcing (backend/crowdsourcing/processor.py),
qui n'est pas concerné par ce chantier.

## Pourquoi une cascade et pas un modèle fixe

L'API Gemini n'expose AUCUN endpoint de quota. Vérifié sur la clé du projet :
/v1beta/usage → 404, /v1/usage → 404, /v1beta/quota → 404,
/v1beta/rateLimits → 404, /v1beta/tunedModels → 501. `models.list()` ne rend que
des capacités, jamais de consommation. Les compteurs du tableau de bord AI
Studio ne sont lisibles que dans cette interface.

« Utiliser le modèle le plus intelligent encore disponible » s'obtient donc en
réagissant aux refus, pas en les anticipant : on tente le plus apte, et chaque
refus est retenu dans un registre de session. C'est exactement le motif que
backend/tavily_service/key_manager.py applique déjà aux clés Tavily.

Mesuré sur un run réel de neuf modèles : quatre ont échoué (429 limit:0, 503).
La cascade n'est pas une optimisation, c'est ce qui empêche l'extraction d'être
en panne une fois sur deux.

## Le budget est la vraie contrainte

Quotas relevés sur la clé du projet : 5 requêtes/minute, 250 000 tokens/minute,
**20 requêtes/jour** sur les Flash de tête. Une école complète demande une
quinzaine d'extractions. D'où deux dispositifs :

  - `min_tier` : chaque catégorie déclare un plancher de qualité. Sous ce
    plancher, on n'écrit pas un ticket bas de gamme — on lève
    ExtractionUnavailable et le prochain cycle réessaiera.
  - sérialisation : les neuf appels du run de mesure, partis ensemble, ont
    saturé les 5 RPM et provoqué des 503 qui disparaissaient en séquentiel.
    Toute extraction passe par un portillon global espacé.

Référence : dossier « Le rapport avant le schéma », sections 06 et 11.
"""

import json
import logging
import os
import re
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from google import genai
from google.genai import types

# sanitize_source() et wrap_source() sont les SEULES portes d'entrée autorisées
# pour du contenu externe dans un prompt. Elles vivent dans gemma_client et sont
# réutilisées telles quelles : dupliquer la neutralisation des délimiteurs, ce
# serait ouvrir une seconde porte à maintenir en parallèle.
from backend.ai.gemma_client import sanitize_source, wrap_source  # noqa: F401

logger = logging.getLogger("pipeline.gemini")


# ── Échelle de modèles ────────────────────────────────────────────
#
# Ordre = du plus apte au moins apte. Le palier ("high"/"mid"/"low") sert de
# plancher de qualité par catégorie : une extraction de classements ne doit pas
# se rabattre silencieusement sur un flash-lite.
#
# Latences et rendements mesurés sur la même tâche (extraire les classements
# d'un rapport de 3 567 tokens) :
#   3.7-flash          13,6 s →  9 classements
#   3.5-flash          19,4 s → 10 classements
#   3-flash-preview    30,9 s → 13 classements
#   3.5-flash-lite     24,9 s → 11 classements
#   2.5-flash          19,3 s →  9 classements
#   3.1-pro-preview    429 limit:0 (jamais ouvert au free tier sur cette clé)
#   3.8-flash          503 (surcharge passagère)
MODEL_LADDER: list[tuple[str, str]] = [
    ("models/gemini-3.8-flash", "high"),
    ("models/gemini-3.7-flash", "high"),
    ("models/gemini-3.6-flash", "high"),
    ("models/gemini-3.5-flash", "mid"),
    ("models/gemini-3-flash-preview", "mid"),
    ("models/gemini-3.5-flash-lite", "low"),
    ("models/gemini-3.1-flash-lite", "low"),
    ("models/gemini-2.5-flash", "low"),
]

# Comparaison des paliers. Un modèle est éligible si son rang est >= celui du
# plancher demandé.
TIER_RANK: dict[str, int] = {"low": 1, "mid": 2, "high": 3}

# Fuseau des quotas Gemini : les compteurs journaliers repartent à minuit
# Pacifique, pas à minuit UTC ni à minuit locale.
PACIFIC_TZ = "America/Los_Angeles"

# 5 requêtes/minute sur la clé → 12 s d'espacement minimal entre deux appels.
# Réglable par variable d'environnement pour une clé au quota différent.
MIN_SECONDS_BETWEEN_CALLS = float(
    os.environ.get("GEMINI_MIN_SECONDS_BETWEEN_CALLS", 12.0)
)

# Refroidissement d'un 503 : surcharge passagère du modèle, pas un quota.
# On repasse dessus au prochain cycle sans le déclasser durablement.
UNAVAILABLE_COOLDOWN_SECONDS = 60.0

# Refroidissement par défaut d'un 429 dont on ne sait pas lire le délai.
DEFAULT_QUOTA_COOLDOWN_SECONDS = 60.0

# Timeout par défaut d'un appel, en millisecondes. Le SDK google-genai retente
# en interne : sans timeout explicite, un modèle lent immobilise un thread
# APScheduler indéfiniment (mesuré à plus de dix minutes avec Gemma).
DEFAULT_TIMEOUT_MS = 120_000

# Le modèle produit du JSON, jamais de la prose : température au plancher.
EXTRACTION_TEMPERATURE = 0.1

# 4xx qui ne condamnent PAS la requête. Le reste des 4xx (400, 401, 403, 404)
# signale une requête ou une clé invalide : les rejouer huit fois de suite ne
# ferait que répéter la même erreur, donc la cascade s'arrête. Ces trois-là
# disent seulement que cet appel-ci n'a pas abouti :
#   408 Request Timeout
#   429 déjà traité plus haut, listé ici pour que la lecture soit complète
#   499 CANCELLED — renvoyé par l'API Gemini quand l'appel est interrompu.
#       Observé en production : un 499 faisait avorter toute la cascade.
TRANSIENT_CLIENT_CODES = frozenset({408, 499})


# ── Exceptions ────────────────────────────────────────────────────

class GeminiError(Exception):
    """Base des erreurs de la couche d'extraction Gemini."""


class ExtractionUnavailable(GeminiError):
    """
    Levée quand l'échelle est épuisée au-dessus du plancher demandé.

    C'est un échec explicite, et c'est voulu : mieux vaut ne pas écrire de
    ticket que d'en écrire un dégradé. Le prochain cycle du cron réessaiera,
    avec des compteurs journaliers éventuellement remis à zéro.
    """


class ExtractionParsingError(GeminiError):
    """
    Levée quand la réponse d'un modèle n'est pas du JSON exploitable.

    Rare avec `response_json_schema`, mais pas impossible : une réponse tronquée
    (finish_reason != STOP) ou vide passe par ici.
    """


# ── Registre de session ───────────────────────────────────────────

@dataclass
class ModelState:
    """État d'un modèle de l'échelle, pour la durée du processus."""

    model_id: str
    tier: str
    # 429 avec « limit: 0 » : le modèle n'est pas ouvert à cette clé. Aucun
    # délai ne le rendra disponible — on ne le retente jamais de la session.
    disabled: bool = False
    disabled_reason: str = ""
    # Horodatage Unix jusqu'auquel le modèle est écarté (429 RPM/RPD, 503).
    cooldown_until: float = 0.0
    # Ce qui se rapproche le plus d'une lecture de quota, faute d'endpoint :
    # on compte nous-mêmes les appels réussis, remis à zéro à minuit Pacifique.
    requests_today: int = 0
    day_key: str = ""
    last_error: str = ""


def _pacific_day_key(now: Optional[datetime] = None) -> str:
    """
    Date courante côté Pacifique, au format YYYY-MM-DD.

    Repli sur UTC-8 si la base de fuseaux n'est pas installée : le décalage
    d'une heure avec l'heure d'été américaine décale la remise à zéro, il ne la
    supprime pas. Un compteur qui repart une heure trop tôt ou trop tard reste
    infiniment préférable à un plantage d'import.
    """
    moment = now or datetime.now(timezone.utc)
    try:
        from zoneinfo import ZoneInfo

        return moment.astimezone(ZoneInfo(PACIFIC_TZ)).strftime("%Y-%m-%d")
    except Exception:
        return (moment.astimezone(timezone.utc) - timedelta(hours=8)).strftime("%Y-%m-%d")


def _seconds_until_pacific_midnight(now: Optional[datetime] = None) -> float:
    """Secondes restantes avant la remise à zéro des quotas journaliers."""
    moment = now or datetime.now(timezone.utc)
    try:
        from zoneinfo import ZoneInfo

        local = moment.astimezone(ZoneInfo(PACIFIC_TZ))
    except Exception:
        local = moment.astimezone(timezone.utc) - timedelta(hours=8)

    tomorrow = (local + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return max(60.0, (tomorrow - local).total_seconds())


class ModelRegistry:
    """
    Registre thread-safe de l'état des modèles, pour la durée du processus.

    Motif repris de TavilyKeyManager : le compteur local fait autorité, et rien
    ne réactive un modèle désactivé en cours de session. Sur les clés Tavily,
    une branche qui remettait `exhausted` à False rouvrait une clé refusée par
    l'API et la faisait solliciter en boucle ; la même erreur est possible ici,
    et le seul assouplissement admis est l'expiration d'un refroidissement
    daté.
    """

    def __init__(self, ladder: Optional[list[tuple[str, str]]] = None):
        self._lock = threading.Lock()
        self._states: dict[str, ModelState] = {}
        self._ladder = list(ladder if ladder is not None else MODEL_LADDER)
        today = _pacific_day_key()
        for model_id, tier in self._ladder:
            self._states[model_id] = ModelState(
                model_id=model_id, tier=tier, day_key=today
            )

    @property
    def ladder(self) -> list[tuple[str, str]]:
        return list(self._ladder)

    def _roll_day_if_needed(self, state: ModelState, today: str) -> None:
        """Remet le compteur journalier à zéro au passage de minuit Pacifique."""
        if state.day_key != today:
            if state.requests_today:
                logger.info(
                    "🔄 Reset journalier Gemini %s (était: %d requêtes)",
                    state.model_id,
                    state.requests_today,
                )
            state.day_key = today
            state.requests_today = 0

    def candidates(self, min_tier: str = "low") -> list[ModelState]:
        """
        Modèles éligibles, du plus apte au moins apte.

        Écarte : les désactivés (429 limit:0), les refroidis dont le délai n'est
        pas écoulé, et tout ce qui se situe sous le plancher demandé.
        """
        floor = TIER_RANK.get(min_tier, 1)
        now = time.time()
        today = _pacific_day_key()
        out: list[ModelState] = []
        with self._lock:
            for model_id, _ in self._ladder:
                state = self._states[model_id]
                self._roll_day_if_needed(state, today)
                if TIER_RANK.get(state.tier, 0) < floor:
                    continue
                if state.disabled:
                    continue
                if state.cooldown_until > now:
                    continue
                out.append(state)
        return out

    def disable(self, model_id: str, reason: str) -> None:
        """Écarte un modèle pour toute la session (429 avec limit: 0)."""
        with self._lock:
            state = self._states.get(model_id)
            if state is None:
                return
            if not state.disabled:
                logger.warning(
                    "🚫 Modèle %s désactivé pour la session : %s", model_id, reason
                )
            state.disabled = True
            state.disabled_reason = reason
            state.last_error = reason

    def cool_down(self, model_id: str, seconds: float, reason: str) -> None:
        """Écarte temporairement un modèle. Un refroidissement ne se raccourcit jamais."""
        with self._lock:
            state = self._states.get(model_id)
            if state is None:
                return
            until = time.time() + max(0.0, seconds)
            state.cooldown_until = max(state.cooldown_until, until)
            state.last_error = reason
        logger.warning(
            "❄️ Modèle %s refroidi %.0f s : %s", model_id, seconds, reason
        )

    def record_success(self, model_id: str) -> None:
        """Incrémente le compteur journalier après un appel abouti."""
        today = _pacific_day_key()
        with self._lock:
            state = self._states.get(model_id)
            if state is None:
                return
            self._roll_day_if_needed(state, today)
            state.requests_today += 1

    def snapshot(self) -> list[dict]:
        """État lisible du registre — pour le monitoring et les tests."""
        now = time.time()
        today = _pacific_day_key()
        with self._lock:
            states = [self._states[model_id] for model_id, _ in self._ladder]
            return [
                {
                    "model": state.model_id,
                    "tier": state.tier,
                    "disabled": state.disabled,
                    "disabled_reason": state.disabled_reason,
                    "cooling_for": max(0.0, round(state.cooldown_until - now, 1)),
                    # Le compteur d'hier ne dit rien du budget d'aujourd'hui.
                    "requests_today": (
                        state.requests_today if state.day_key == today else 0
                    ),
                    "last_error": state.last_error,
                }
                for state in states
            ]


# Registre partagé par tout le processus.
_registry = ModelRegistry()


def get_registry() -> ModelRegistry:
    """Registre de session partagé (monitoring, tests)."""
    return _registry


# ── Portillon RPM ─────────────────────────────────────────────────
#
# Les neuf appels du run de mesure, lancés en parallèle, ont saturé les 5 RPM
# de la clé : 3.6-flash et 3.1-flash-lite répondaient 503 en rafale et
# passaient sans broncher en séquentiel. Ce portillon sérialise TOUS les appels
# du processus et les espace.

_gate_lock = threading.Lock()
_last_call_at = 0.0


def _wait_for_slot() -> None:
    """Bloque jusqu'à ce que l'espacement minimal entre appels soit respecté."""
    global _last_call_at
    with _gate_lock:
        wait = MIN_SECONDS_BETWEEN_CALLS - (time.time() - _last_call_at)
        if wait > 0:
            logger.debug("⏸️ Portillon RPM Gemini : attente %.1f s", wait)
            time.sleep(wait)
        _last_call_at = time.time()


# ── Client API (singleton) ────────────────────────────────────────

_client: genai.Client | None = None
_client_lock = threading.Lock()


def get_client() -> genai.Client:
    """Client Google GenAI (lazy init, singleton)."""
    global _client
    with _client_lock:
        if _client is None:
            api_key = os.environ.get("GEMINI_API_KEY")
            if not api_key:
                raise RuntimeError(
                    "GEMINI_API_KEY non définie dans les variables d'environnement"
                )
            _client = genai.Client(api_key=api_key)
            logger.info("✅ Client Gemini initialisé")
        return _client


def reset_client() -> None:
    """Réinitialise le singleton — utilisé par les tests."""
    global _client
    with _client_lock:
        _client = None


# ── Lecture des refus ─────────────────────────────────────────────
#
# Le payload 429 exact, relevé sur la clé du projet :
#
#   google.genai.errors.ClientError · .code=429 · .status='RESOURCE_EXHAUSTED'
#   "message": "You exceeded your current quota, ...
#     * Quota exceeded for metric: generativelanguage.googleapis.com/
#       generate_content_free_tier_requests, limit: 0, model: gemini-3.1-pro
#     Please retry in 3.481302195s."
#
# Deux informations à en tirer : `limit: 0` sépare « jamais disponible » de
# « momentanément épuisé », et `Please retry in Xs` donne la durée d'attente
# réelle au lieu d'en inventer une.

_LIMIT_RE = re.compile(r"limit:\s*(\d+)", re.IGNORECASE)
_RETRY_RE = re.compile(r"retry\s+in\s+([0-9]+(?:\.[0-9]+)?)\s*s", re.IGNORECASE)
_RETRY_DELAY_RE = re.compile(
    r"retryDelay[\"']?\s*[:=]\s*[\"']?([0-9]+(?:\.[0-9]+)?)s", re.IGNORECASE
)
# Un quota journalier ne se rouvre pas au bout de quelques secondes : il faut
# attendre minuit Pacifique. Le nom de la métrique est le seul indice fiable.
_PER_DAY_RE = re.compile(r"per[_\s-]?day|requests_per_day|daily", re.IGNORECASE)


def _error_code(error: Exception) -> int | None:
    """Code HTTP de l'exception, quel que soit le client sous-jacent."""
    code = getattr(error, "code", None)
    if not isinstance(code, int):
        code = getattr(error, "status_code", None)
    return code if isinstance(code, int) else None


def _error_message(error: Exception) -> str:
    """Message complet de l'exception, détails du SDK compris."""
    parts = [str(error)]
    message = getattr(error, "message", None)
    if isinstance(message, str):
        parts.append(message)
    details = getattr(error, "details", None)
    if details is not None:
        try:
            parts.append(json.dumps(details, ensure_ascii=False))
        except (TypeError, ValueError):
            parts.append(str(details))
    return " ".join(parts)


def _is_timeout_error(error: Exception) -> bool:
    """Vrai si l'échec est un dépassement de délai (côté client ou 504)."""
    if _error_code(error) == 504:
        return True
    text = f"{type(error).__name__} {_error_message(error)}".lower()
    return "timeout" in text or "timed out" in text or "deadline_exceeded" in text


@dataclass
class QuotaVerdict:
    """Décision tirée d'un refus 429."""

    permanent: bool  # limit: 0 → jamais ouvert à cette clé
    cooldown_seconds: float
    reason: str


def parse_quota_error(message: str) -> QuotaVerdict:
    """
    Traduit un message 429 en décision de cascade.

    - `limit: 0`     → le modèle n'est pas ouvert au free tier sur cette clé.
                       Aucun délai n'y changera rien : désactivation de session.
    - métrique /jour → refroidir jusqu'à minuit Pacifique.
    - sinon          → refroidir de la durée annoncée par « Please retry in Xs ».
    """
    limits = [int(m) for m in _LIMIT_RE.findall(message)]
    if limits and all(limit == 0 for limit in limits):
        return QuotaVerdict(
            permanent=True,
            cooldown_seconds=0.0,
            reason="429 limit:0 — modèle non ouvert au free tier sur cette clé",
        )

    if _PER_DAY_RE.search(message):
        return QuotaVerdict(
            permanent=False,
            cooldown_seconds=_seconds_until_pacific_midnight(),
            reason="429 quota journalier épuisé — attente de minuit Pacifique",
        )

    match = _RETRY_RE.search(message) or _RETRY_DELAY_RE.search(message)
    if match:
        return QuotaVerdict(
            permanent=False,
            cooldown_seconds=float(match.group(1)),
            reason=f"429 quota RPM — délai annoncé {match.group(1)}s",
        )

    return QuotaVerdict(
        permanent=False,
        cooldown_seconds=DEFAULT_QUOTA_COOLDOWN_SECONDS,
        reason="429 sans délai lisible — refroidissement par défaut",
    )


# ── Décodage de la réponse ────────────────────────────────────────

def _decode_response(response: Any, model_id: str) -> Any:
    """
    Transforme une réponse Gemini en objet Python.

    Deux garde-fous hérités de bugs déjà payés :

      - `response.text` vaut None quand le modèle ne renvoie aucune part
        textuelle. `len(None)` lève, et la garde censée absorber une réponse
        vide était précisément ce qui cassait. D'où le `or ""`.
      - AUCUN aplatissement. gemma_client réduisait une liste JSON à son
        premier élément avec un simple warning : sur une extraction de
        classements ou d'accréditations, c'est une perte silencieuse massive.
        Ici un schéma qui attend un tableau reçoit un tableau.
    """
    candidates = getattr(response, "candidates", None)
    if candidates:
        finish_reason = getattr(candidates[0], "finish_reason", None)
        name = getattr(finish_reason, "name", None) or (
            str(finish_reason) if finish_reason else None
        )
        if name and name != "STOP":
            raise ExtractionParsingError(
                f"Réponse tronquée par {model_id} (finish_reason={name})"
            )

    raw_text = getattr(response, "text", None) or ""
    if len(raw_text.strip()) < 2:
        raise ExtractionParsingError(f"Réponse vide de {model_id}")

    try:
        return json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise ExtractionParsingError(
            f"JSON invalide renvoyé par {model_id} : {exc} — brut : {raw_text[:300]}"
        ) from exc


# ── Point d'entrée ────────────────────────────────────────────────

def extract_structured(
    system_prompt: str,
    source_text: str,
    json_schema: dict,
    min_tier: str = "low",
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
    source_limit: Optional[int] = None,
    registry: Optional[ModelRegistry] = None,
) -> Any:
    """
    Transforme un texte en JSON conforme à `json_schema`, via le meilleur
    modèle Gemini encore disponible.

    Args:
        system_prompt: Consignes d'extraction. Les règles anti-injection sont
            obligatoires ; la description de la structure JSON ne l'est plus,
            `response_json_schema` la garantit.
        source_text: Texte à analyser (rapport Tavily, page catalogue…). Il est
            encadré par wrap_source() — jamais concaténé brut.
        json_schema: JSON Schema passé en `response_json_schema`.
        min_tier: Plancher de qualité de la catégorie ("high"/"mid"/"low").
        timeout_ms: Timeout par appel, en millisecondes.
        source_limit: Troncature optionnelle du texte source.
        registry: Registre à utiliser (défaut : celui du processus).

    Returns:
        L'objet décodé — un dict pour tous les schémas de ce dépôt, qui
        déclarent tous un objet racine. Le type de retour reste large parce que
        rien n'est jamais aplati : un schéma qui déclare un tableau rend un
        tableau, à la racine comme dans une clé.

    Raises:
        ExtractionUnavailable: L'échelle est épuisée au-dessus de `min_tier`.
    """
    reg = registry or _registry
    client = get_client()
    user_content = wrap_source(source_text, limit=source_limit)

    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        temperature=EXTRACTION_TEMPERATURE,
        response_mime_type="application/json",
        response_json_schema=json_schema,
        http_options=types.HttpOptions(timeout=timeout_ms),
    )

    candidates = reg.candidates(min_tier=min_tier)
    if not candidates:
        raise ExtractionUnavailable(
            f"Aucun modèle Gemini disponible au palier '{min_tier}' ou au-dessus. "
            f"Registre : {reg.snapshot()}"
        )

    last_error: Exception | None = None

    for state in candidates:
        model_id = state.model_id
        _wait_for_slot()
        started = time.time()
        try:
            logger.info("🧠 Extraction via %s (palier %s)", model_id, state.tier)
            response = client.models.generate_content(
                model=model_id,
                contents=user_content,
                config=config,
            )
            data = _decode_response(response, model_id)
            reg.record_success(model_id)
            logger.info(
                "✅ Extraction réussie via %s en %.1f s", model_id, time.time() - started
            )
            return data

        except ExtractionParsingError as exc:
            # Le modèle a répondu mais sa sortie est inexploitable : on ne le
            # refroidit pas durablement, on passe simplement au suivant.
            logger.warning("⚠️ %s", exc)
            last_error = exc
            continue

        except Exception as exc:  # noqa: BLE001 — on trie sur le code, pas le type
            code = _error_code(exc)
            message = _error_message(exc)
            last_error = exc

            if code == 429:
                verdict = parse_quota_error(message)
                if verdict.permanent:
                    reg.disable(model_id, verdict.reason)
                else:
                    reg.cool_down(model_id, verdict.cooldown_seconds, verdict.reason)
                continue

            if _is_timeout_error(exc):
                # Modèle trop lent pour la tâche : au suivant immédiatement, et
                # un court refroidissement pour ne pas y revenir dans la foulée.
                reg.cool_down(
                    model_id, UNAVAILABLE_COOLDOWN_SECONDS, "timeout / 504"
                )
                logger.warning("⏱️ Timeout sur %s — modèle suivant", model_id)
                continue

            if code == 503 or "unavailable" in message.lower():
                reg.cool_down(
                    model_id, UNAVAILABLE_COOLDOWN_SECONDS, "503 UNAVAILABLE"
                )
                continue

            if isinstance(code, int) and code in TRANSIENT_CLIENT_CODES:
                # Ces 4xx-là ne disent RIEN sur la validité de la requête : elles
                # disent que cet appel-ci n'est pas allé au bout. Observé en
                # production sur un rapport de 6 400 caractères — un 499
                # CANCELLED a fait avorter toute la cascade alors que sept
                # modèles sains attendaient derrière.
                reg.cool_down(
                    model_id, UNAVAILABLE_COOLDOWN_SECONDS, f"{code} transitoire"
                )
                logger.warning(
                    "⚠️ %s sur %s (transitoire) — modèle suivant", code, model_id
                )
                continue

            if isinstance(code, int) and 400 <= code < 500:
                # 400, 401, 403, 404 : requête ou clé invalide. Rejouer sur un
                # autre modèle ne corrigera rien, et la même erreur reviendra
                # huit fois de suite.
                raise GeminiError(
                    f"Erreur Gemini définitive ({code}) sur {model_id} : {message}"
                ) from exc

            logger.warning(
                "⚠️ Erreur inattendue sur %s (%s) — modèle suivant : %s",
                model_id,
                code,
                exc,
            )
            reg.cool_down(model_id, UNAVAILABLE_COOLDOWN_SECONDS, f"erreur {code}")

    raise ExtractionUnavailable(
        f"Échelle Gemini épuisée au palier '{min_tier}' après "
        f"{len(candidates)} tentative(s). Dernière erreur : {last_error}. "
        f"Registre : {reg.snapshot()}"
    )
