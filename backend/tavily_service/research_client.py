"""
Client Tavily Research — Appels asynchrones avec polling.

Workflow :
  1. POST /research → obtenir request_id
  2. Boucle GET /research/{request_id} → attendre "completed"
  3. Retourner le rapport + sources

Gestion des erreurs :
  - Timeout global (max_wait_seconds)
  - Task failed (status = "failed")
  - QuotaExhaustedError (propagée depuis key_manager)
"""

import time
import logging
from typing import Optional, Any
from tavily import TavilyClient
from backend.tavily_service.key_manager import QuotaExhaustedError

logger = logging.getLogger("pipeline.research_client")

# Crédits estimés par modèle (pour le tracking key_manager)
ESTIMATED_CREDITS = {
    "mini": 10,   # Moyenne estimée 4-15
    "pro": 25,    # Moyenne estimée 15-50
}

REQUIRED_CREDITS_PRO = 250
REQUIRED_CREDITS_MINI = 50


class ResearchTimeoutError(Exception):
    """Levée quand le polling dépasse max_wait_seconds."""
    pass


class ResearchTaskFailedError(Exception):
    """Levée quand Tavily rapporte un échec de la tâche."""
    pass


def create_research_task(
    query: str,
    key_manager: Any,
    include_domains: Optional[list[str]] = None,
    output_schema: Optional[dict] = None,
    model: str = "pro",
    max_wait_seconds: int = 600,
    poll_interval: float = 5.0,
    dry_run: bool = False,
) -> dict:
    """
    Lance une tâche Tavily Research et attend le résultat (polling).

    Args:
        query: Question de recherche (prompt dynamique)
        key_manager: Instance de TavilyKeyManager
        include_domains: Domaines prioritaires (soft preference)
        output_schema: JSON Schema pour forcer le format de sortie
        model: "mini" (4-15 crédits) ou "pro" (15+ crédits)
        max_wait_seconds: Timeout global du polling (défaut: 600s = 10min — Research pro peut être lent)
        poll_interval: Intervalle entre les GET de polling (défaut: 5s)
        dry_run: Si True, log le prompt mais ne lance pas l'appel

    Returns:
        {
            "report": str | dict,     # Rapport textuel ou JSON (si output_schema)
            "sources": list[dict],    # [{"title": ..., "url": ...}]
            "credits_used": int,      # Estimation des crédits consommés
            "status": "completed",
            "request_id": str
        }

    Raises:
        ResearchTimeoutError: Si le polling dépasse max_wait_seconds
        ResearchTaskFailedError: Si la tâche échoue côté Tavily
        QuotaExhaustedError: Si toutes les clés Tavily sont épuisées
    """
    if dry_run:
        logger.info(f"🧪 [DRY RUN] Research query:\n{query}")
        logger.info(f"🧪 [DRY RUN] include_domains={include_domains}")
        logger.info(f"🧪 [DRY RUN] output_schema={'YES' if output_schema else 'NO'}")
        return {
            "report": "[DRY RUN — aucun appel effectué]",
            "sources": [],
            "credits_used": 0,
            "status": "dry_run",
            "request_id": "dry-run-000"
        }

    # Mots-clés dans les messages d'erreur Tavily indiquant un quota dépassé côté API
    _QUOTA_ERROR_PHRASES = (
        "exceeds your plan",
        "usage limit",
        "rate limit",
        "quota",
        "upgrade your plan",
    )

    req_credits = REQUIRED_CREDITS_PRO if model == "pro" else REQUIRED_CREDITS_MINI
    max_retries = key_manager.total_keys  # On ne réessaie pas plus de fois qu'il n'y a de clés
    last_error: Exception | None = None

    for attempt in range(max_retries):
        # Obtenir une clé active avec suffisamment de crédits
        try:
            api_key = key_manager.get_active_key(required_credits=req_credits)
        except QuotaExhaustedError:
            raise

        client = TavilyClient(api_key=api_key)
        logger.info(f"🔬 Tavily Research ({model}, clé ...{api_key[-6:]}) : '{query[:100]}...'")

        # ── 1. Lancer la tâche ─────────────────────────────────────
        research_params: dict = {
            "input": query,
            "model": model,
        }
        if include_domains:
            research_params["include_domains"] = include_domains
        if output_schema:
            research_params["output_schema"] = output_schema

        try:
            # Appeler le SDK Tavily
            response = client.research(**research_params)

            request_id = response.get("request_id") or response.get("id")
            if not request_id:
                raise ResearchTaskFailedError(f"Pas de request_id dans la réponse: {response}")

            logger.info(f"📋 Research task créée: {request_id}")

            # ── 2. Polling ─────────────────────────────────────────────
            result = _poll_research_task(
                client=client,
                request_id=request_id,
                max_wait_seconds=max_wait_seconds,
                poll_interval=poll_interval,
            )

            # ── 3. Déterminer les crédits et enregistrer l'utilisation ──
            credits_consumed = result.get("credits") or result.get("credits_used")
            if not credits_consumed:
                credits_consumed = ESTIMATED_CREDITS.get(model, 25)

            key_manager.record_usage(api_key, credits=credits_consumed)

            return {
                "report": result.get("content", ""),
                "sources": result.get("sources", []),
                "credits_used": credits_consumed,
                "status": "completed",
                "request_id": request_id,
            }

        except QuotaExhaustedError:
            raise
        except Exception as e:
            error_str = str(e).lower()
            # Détecter les erreurs de quota renvoyées directement par l'API Tavily
            if any(phrase in error_str for phrase in _QUOTA_ERROR_PHRASES):
                logger.warning(
                    f"⚠️ Quota API Tavily dépassé sur clé ...{api_key[-6:]} "
                    f"— marquée épuisée, retry {attempt + 1}/{max_retries}"
                )
                # Forcer l'épuisement dans le tracker local pour ne pas re-sélectionner cette clé
                key_manager.mark_exhausted(api_key)
                last_error = e
                continue  # Retry avec la prochaine clé disponible
            else:
                logger.error(f"❌ Échec de la recherche Tavily Research: {e}")
                raise

    # Toutes les clés ont renvoyé une erreur de quota API
    raise QuotaExhaustedError(
        f"Toutes les clés Tavily ont atteint la limite API après {max_retries} tentatives. "
        f"Dernière erreur: {last_error}"
    )



def _poll_research_task(
    client: TavilyClient,
    request_id: str,
    max_wait_seconds: int = 180,
    poll_interval: float = 5.0,
) -> dict:
    """
    Boucle de polling sur l'état de la tâche.
    """
    start_time = time.time()
    attempts = 0
    while time.time() - start_time < max_wait_seconds:
        attempts += 1
        try:
            response = client.get_research(request_id=request_id)
            status = response.get("status")
            logger.info(f"⏳ Polling task {request_id} (tentative {attempts}) — statut: {status}")

            if status == "completed":
                return response
            elif status == "failed":
                error_msg = response.get("error") or "Unknown error"
                raise ResearchTaskFailedError(f"La tâche {request_id} a échoué: {error_msg}")

        except ResearchTaskFailedError:
            raise
        except Exception as e:
            logger.warning(f"⚠️ Erreur lors du polling de {request_id}: {e}")

        time.sleep(poll_interval)

    raise ResearchTimeoutError(
        f"La tâche de recherche {request_id} a dépassé le temps d'attente maximum de {max_wait_seconds}s."
    )
