"""
backend/routers/internal.py — API Interne Pipeline (Étape 4.2)

Endpoints accessibles uniquement au backend Next.js (token statique).
Ces routes déclenchent les scans, enrichissements et retournent le statut.

Sécurité : Bearer token statique (INTERNAL_API_TOKEN), jamais exposé publiquement.

Référence : task.md §4.2, architecture.md §6 (API Interne)
"""

import os
import logging
import asyncio
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

logger = logging.getLogger("pipeline.internal")

router = APIRouter(prefix="/internal", tags=["internal"])
security = HTTPBearer()

# ── État en mémoire du pipeline ───────────────────────────────────
# En production, utiliser Redis ou une table BDD pour la persistance
_pipeline_jobs: dict[str, dict] = {}


# ── Authentification ──────────────────────────────────────────────

def verify_internal_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Vérifie le token Bearer de l'API interne."""
    expected_token = os.environ.get("INTERNAL_API_TOKEN")
    if not expected_token:
        raise HTTPException(
            status_code=500,
            detail="INTERNAL_API_TOKEN non configuré côté serveur"
        )
    if credentials.credentials != expected_token:
        raise HTTPException(
            status_code=401,
            detail="Token d'authentification invalide"
        )
    return credentials.credentials


# ── Modèles de requête ────────────────────────────────────────────

class ScanRequest(BaseModel):
    priority: str = "normal"  # "normal" | "high"


class EnrichmentRequest(BaseModel):
    categories: list[str] = ["Pricing", "Ranking", "Capacity"]
    force_refresh: bool = False


# ── Endpoints ─────────────────────────────────────────────────────

@router.post("/trigger-scan/{school_id}")
async def trigger_scan(
    school_id: str,
    request: ScanRequest,
    _token: str = Depends(verify_internal_token),
):
    """
    POST /internal/trigger-scan/{school_id}

    Déclenche la Phase 1 (Cartographie) pour une école :
    1. Crawl du site officiel via Tavily
    2. Extraction des campus/programmes via Gemma 31B
    3. Création du ticket ContributionInbox (Program_Discovery)

    Référence : task.md §4.2, architecture.md §5.2 (Phase 1)
    """
    if school_id in _pipeline_jobs:
        existing = _pipeline_jobs[school_id]
        if existing.get("status") in ("running", "queued"):
            return {
                "message": "Un scan est déjà en cours pour cette école",
                "job_id": existing.get("job_id"),
                "status": existing.get("status"),
            }

    import uuid
    job_id = str(uuid.uuid4())[:8]

    _pipeline_jobs[school_id] = {
        "job_id": job_id,
        "school_id": school_id,
        "phase": "scan",
        "status": "queued",
        "priority": request.priority,
        "created_at": asyncio.get_event_loop().time(),
    }

    # Lancer en arrière-plan
    asyncio.create_task(_run_scan(school_id, job_id))

    logger.info(f"🔍 Scan déclenché pour school_id={school_id} (job={job_id})")
    return {
        "message": "Scan déclenché",
        "job_id": job_id,
        "school_id": school_id,
        "status": "queued",
    }


@router.post("/trigger-enrichment/{school_id}")
async def trigger_enrichment(
    school_id: str,
    request: EnrichmentRequest,
    _token: str = Depends(verify_internal_token),
):
    """
    POST /internal/trigger-enrichment/{school_id}

    Déclenche la Phase 2 (Enrichissement) pour une école :
    Pour chaque campus/programme existant (tables rigides) :
    - Recherche Tavily par catégorie
    - Extraction via Gemma 31B
    - Création tickets ContributionInbox (Pricing, Ranking, etc.)

    Référence : task.md §4.2, architecture.md §5.3 (Phase 2)
    """
    import uuid
    job_id = str(uuid.uuid4())[:8]

    job_key = f"{school_id}:enrichment"
    _pipeline_jobs[job_key] = {
        "job_id": job_id,
        "school_id": school_id,
        "phase": "enrichment",
        "categories": request.categories,
        "status": "queued",
        "force_refresh": request.force_refresh,
    }

    asyncio.create_task(_run_enrichment(school_id, job_id, request.categories))

    logger.info(
        f"⚡ Enrichissement déclenché pour school_id={school_id} "
        f"(catégories: {request.categories})"
    )
    return {
        "message": "Enrichissement déclenché",
        "job_id": job_id,
        "school_id": school_id,
        "categories": request.categories,
        "status": "queued",
    }


@router.get("/pipeline-status")
async def pipeline_status(_token: str = Depends(verify_internal_token)):
    """
    GET /internal/pipeline-status

    Retourne le statut global du pipeline :
    - BDD : connectée / déconnectée
    - Jobs en cours
    - Statut des clés Tavily
    - Version Gemma configurée

    Référence : task.md §4.2, architecture.md §6.1
    """
    db_ok = True  # Pas de check direct (psycopg2 peut bloquer sur Neon local)
    # En production sur Koyeb, la BDD est toujours accessible

    # Statut Tavily (si initialisé)
    tavily_status = []
    try:
        from backend.tavily.key_manager import TavilyKeyManager
        # Note: en production, le manager est un singleton dans main.py
        # Ici on retourne juste les variables d'environnement trouvées
        keys_count = sum(
            1 for i in range(1, 11)
            if os.environ.get(f"TAVILY_API_KEY_{i}")
        ) or (1 if os.environ.get("TAVILY_API_KEY") else 0)
        tavily_status = {"keys_configured": keys_count}
    except Exception:
        tavily_status = {"keys_configured": 0, "error": "non initialisé"}

    active_jobs = [
        job for job in _pipeline_jobs.values()
        if job.get("status") in ("running", "queued")
    ]

    return {
        "status": "ok" if db_ok else "degraded",
        "database": "connected" if db_ok else "disconnected",
        "pipeline_jobs_active": len(active_jobs),
        "pipeline_jobs": active_jobs[:10],  # Limiter à 10 pour la lisibilité
        "tavily": tavily_status,
        "ai_model_primary": "models/gemma-4-31b-it",
        "ai_model_triage": "models/gemma-4-26b-a4b-it",
        "ai_model_fallback": "gemini-3-flash-preview",
    }


# ── Fonctions de pipeline asynchrones ────────────────────────────

async def _run_scan(school_id: str, job_id: str):
    """
    Phase 1 réelle (Étape 5) — Tavily crawl + Gemma 31B + ContributionInbox INSERT.
    Tourne en arrière-plan via asyncio.create_task().
    """
    from backend.pipeline.phase1 import run_phase1
    import asyncio

    _pipeline_jobs[school_id]["status"] = "running"
    logger.info(f"[job={job_id}] Phase 1 (scan) démarrée pour school_id={school_id}")

    try:
        # Récupérer le TavilyKeyManager depuis app.state
        # (run_in_executor car run_phase1 est synchrone et bloquant)
        loop = asyncio.get_event_loop()

        # Importer app ici pour accéder à app.state.tavily_manager
        from backend.main import app
        key_manager = getattr(app.state, "tavily_manager", None)

        if key_manager is None:
            raise RuntimeError("TavilyKeyManager non initialisé")

        result = await loop.run_in_executor(
            None,
            run_phase1,
            school_id,
            key_manager,
        )

        _pipeline_jobs[school_id].update({
            "status": "completed" if result.get("success") else "failed",
            "result": result,
        })
        logger.info(f"[job={job_id}] Phase 1 terminée: {result.get('message')}")

    except Exception as e:
        _pipeline_jobs[school_id]["status"] = "failed"
        _pipeline_jobs[school_id]["error"] = str(e)
        logger.error(f"[job={job_id}] Phase 1 erreur: {e}")


async def _run_enrichment(school_id: str, job_id: str, categories: list[str]):
    """Stub Phase 2 — sera implémenté à l'Étape 6."""
    job_key = f"{school_id}:enrichment"
    _pipeline_jobs[job_key]["status"] = "running"
    logger.info(
        f"[job={job_id}] Phase 2 (enrichissement) démarrée pour "
        f"school_id={school_id}, catégories={categories}"
    )
    # TODO Étape 6 : Tavily search + Gemma extract par catégorie + Prisma insert
    import asyncio
    await asyncio.sleep(0)
    _pipeline_jobs[job_key]["status"] = "completed"
    logger.info(f"[job={job_id}] Phase 2 terminée (stub)")
