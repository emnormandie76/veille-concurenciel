"""
backend/routers/internal.py — API Interne Pipeline (Étape 4.2)

Endpoints accessibles uniquement au backend Next.js (token statique).
Ces routes déclenchent les scans, enrichissements et retournent le statut.

Sécurité : Bearer token statique (INTERNAL_API_TOKEN), jamais exposé publiquement.

Référence : task.md §4.2, architecture.md §6 (API Interne)
"""

import os
import secrets
import logging
import asyncio
import time as time_module
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

logger = logging.getLogger("pipeline.internal")

router = APIRouter(prefix="/internal", tags=["internal"])
security = HTTPBearer()

# ── État en mémoire du pipeline ───────────────────────────────────
# En production, utiliser Redis ou une table BDD pour la persistance
_pipeline_jobs: dict[str, dict] = {}

# ── Progress tracking granulaire ──────────────────────────────────
# Permet au frontend de voir l'étape en cours d'un job
_pipeline_progress: dict[str, dict] = {}


def update_progress(job_id: str, details: dict):
    """Met à jour les détails de progression d'un job en cours."""
    _pipeline_progress[job_id] = {
        **details,
        "updated_at": time_module.time(),
    }


def _cleanup_progress(job_id: str):
    """Supprime les données de progression quand un job est terminé."""
    _pipeline_progress.pop(job_id, None)


def register_cron_job(job_id: str, school_id: str, phase: str):
    """Enregistre un job automatique (Cron) dans l'état du pipeline."""
    job_key = f"cron:{job_id}"
    _pipeline_jobs[job_key] = {
        "job_id": job_id,
        "school_id": school_id,
        "phase": phase,
        "status": "running",
        "source": "cron",
        "created_at": time_module.time(),
    }
    return job_key


def complete_cron_job(job_key: str, status: str, result: dict = None, error: str = None):
    """Met à jour le statut d'un job cron (completed/failed)."""
    if job_key in _pipeline_jobs:
        _pipeline_jobs[job_key].update({
            "status": status,
            "result": result,
            "error": error,
        })


# ── Authentification ──────────────────────────────────────────────

def verify_internal_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Vérifie le token Bearer de l'API interne, en temps constant."""
    # Le meme secret portait trois noms de part et d autre de la meme frontiere
    # de confiance : Next.js envoyait FASTAPI_INTERNAL_TOKEN, FastAPI attendait
    # INTERNAL_API_TOKEN ou INTERNAL_TOKEN. Nom canonique : INTERNAL_API_TOKEN.
    # Les deux autres restent acceptes pour ne casser aucun deploiement.
    expected_token = (
        os.environ.get("INTERNAL_API_TOKEN")
        or os.environ.get("INTERNAL_TOKEN")
        or os.environ.get("FASTAPI_INTERNAL_TOKEN")
    )
    if not expected_token:
        raise HTTPException(
            status_code=500,
            detail="INTERNAL_API_TOKEN non configuré côté serveur"
        )
    # compare_digest et non != : la comparaison native s'arrête au premier
    # octet différent, ce qui laisse fuir la longueur du préfixe correct par
    # mesure du temps de réponse.
    if not secrets.compare_digest(credentials.credentials, expected_token):
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


class TargetedResearchRequest(BaseModel):
    """Requête de recherche ciblée depuis le panneau admin."""
    phase: str = "1"  # "1" ou "2"
    program_id: str | None = None  # UUID du programme cible (Phase 2 uniquement)
    categories: list[str] | None = None  # ["Pricing", "Ranking"] etc. (Phase 2 uniquement)


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
        "phase": "Phase 1 — Cartographie",
        "status": "queued",
        "priority": request.priority,
        "source": "manual",
        "created_at": time_module.time(),
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
        "phase": "Phase 2 — Enrichissement",
        "categories": request.categories,
        "status": "queued",
        "force_refresh": request.force_refresh,
        "source": "manual",
        "created_at": time_module.time(),
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


@router.post("/trigger-targeted-research/{school_id}")
async def trigger_targeted_research(
    school_id: str,
    request: TargetedResearchRequest,
    _token: str = Depends(verify_internal_token),
):
    """
    POST /internal/trigger-targeted-research/{school_id}

    Lance une recherche Research ciblée depuis le panneau admin/cron.
    Permet de cibler :
      - Phase 1 : Cartographie complète d'une école
      - Phase 2 : Un programme spécifique + catégories spécifiques

    Différent de trigger-scan/trigger-enrichment qui sont pour le scheduler.
    """
    # Vérifier qu'aucun job n'est déjà en cours pour cette école
    for key, job in _pipeline_jobs.items():
        if job.get("school_id") == school_id and job.get("status") in ("running", "queued"):
            return {
                "message": "Une tâche est déjà en cours pour cette école",
                "job_id": job.get("job_id"),
                "status": job.get("status"),
                "phase": job.get("phase"),
                "already_running": True,
            }

    # Validation
    if request.phase not in ("1", "2"):
        raise HTTPException(status_code=400, detail="Phase invalide (doit être '1' ou '2')")

    if request.phase == "2" and request.program_id and not request.categories:
        raise HTTPException(
            status_code=400,
            detail="Les catégories sont requises quand un programme est spécifié en Phase 2"
        )

    import uuid
    job_id = str(uuid.uuid4())[:8]

    phase_label = "Phase 1 — Cartographie" if request.phase == "1" else "Phase 2 — Enrichissement ciblé"

    job_key = f"{school_id}:targeted:{job_id}"
    _pipeline_jobs[job_key] = {
        "job_id": job_id,
        "school_id": school_id,
        "phase": phase_label,
        "status": "queued",
        "program_id": request.program_id,
        "categories": request.categories,
        "source": "manual",
        "created_at": time_module.time(),
    }

    asyncio.create_task(
        _run_targeted_research(
            school_id=school_id,
            job_id=job_id,
            job_key=job_key,
            phase=request.phase,
            program_id=request.program_id,
            categories=request.categories,
        )
    )

    logger.info(
        f"🚀 Recherche ciblée déclenchée pour school_id={school_id} "
        f"(phase={request.phase}, program={request.program_id}, categories={request.categories})"
    )
    return {
        "message": "Recherche ciblée déclenchée",
        "job_id": job_id,
        "school_id": school_id,
        "phase": phase_label,
        "program_id": request.program_id,
        "categories": request.categories,
        "status": "queued",
    }


@router.get("/pipeline-status")
async def pipeline_status(request: Request, _token: str = Depends(verify_internal_token)):
    """
    GET /internal/pipeline-status

    Retourne le statut global du pipeline :
    - BDD : connectée / déconnectée
    - Jobs en cours (avec progress_details granulaires)
    - Statut des clés Tavily
    - Version Gemma configurée

    Référence : task.md §4.2, architecture.md §6.1
    """
    # check_db_connection() existait dans db.py mais n'était jamais appelé :
    # le panneau admin affichait « base connectée » quelle que soit la réalité.
    # L'appel est protégé pour que l'endpoint de supervision ne tombe jamais
    # à cause de ce qu'il est censé superviser.
    try:
        from backend.db import check_db_connection
        db_ok = check_db_connection()
    except Exception as e:
        logger.error(f"❌ Échec du contrôle de connexion BDD: {e}")
        db_ok = False

    # Statut Tavily (si initialisé)
    tavily_status = []
    try:
        tavily_manager = getattr(request.app.state, "tavily_manager", None)
        if tavily_manager:
            tavily_status = tavily_manager.get_status()
        else:
            # Fallback en cas d'absence du manager dans state
            keys_count = sum(
                1 for i in range(1, 11)
                if os.environ.get(f"TAVILY_API_KEY_{i}")
            ) or (1 if os.environ.get("TAVILY_API_KEY") else 0)
            tavily_status = [{"key_suffix": "...", "credits_used": 0, "credits_remaining": 950, "exhausted": False, "keys_configured": keys_count}]
    except Exception as e:
        tavily_status = {"error": f"non initialisé: {e}"}

    # État des jobs périodiques : un cron qui échoue à chaque passage se
    # terminait « normalement » du point de vue d'APScheduler et n'apparaissait
    # nulle part. get_scheduler_status() existait mais n'était jamais appelé.
    try:
        from backend.scheduler.jobs import get_scheduler_status
        scheduler_status = get_scheduler_status()
    except Exception as e:
        scheduler_status = {"running": False, "jobs": [], "error": str(e)}

    active_jobs = [
        {**job} for job in _pipeline_jobs.values()
        if job.get("status") in ("running", "queued")
    ]

    manual_jobs = [job for job in active_jobs if job.get("source", "manual") == "manual"]
    cron_jobs = [job for job in active_jobs if job.get("source") == "cron"]

    # Enrichir chaque job actif avec ses progress_details
    for job in active_jobs:
        job_id = job.get("job_id")
        if job_id and job_id in _pipeline_progress:
            job["progress_details"] = _pipeline_progress[job_id]

    # Un job periodique en echec degrade le pipeline, meme si la BDD repond.
    scheduler_failed = bool(scheduler_status.get("has_failure")) or bool(
        scheduler_status.get("error")
    )

    return {
        "status": "ok" if (db_ok and not scheduler_failed) else "degraded",
        "database": "connected" if db_ok else "disconnected",
        "scheduler": scheduler_status,
        "pipeline_jobs_active": len(manual_jobs) + len(cron_jobs),
        "pipeline_jobs": manual_jobs[:10],  # Limiter à 10 pour la lisibilité
        "cron_jobs": cron_jobs[:10],        # Limiter à 10 pour la lisibilité
        "tavily": tavily_status,
        "ai_model_primary": "models/gemma-4-31b-it",
        "ai_model_triage": "models/gemma-4-26b-a4b-it",
        "ai_model_fallback": "gemini-3-flash-preview",
    }


@router.post("/research-test/{school_id}")
async def research_test(
    school_id: str,
    phase: str = "1",
    category: Optional[str] = None,
    program_id: Optional[str] = None,
    _token: str = Depends(verify_internal_token),
):
    """
    Test dry-run du pipeline Research pour une école.
    Phase 1 : Cartographie.
    Phase 2 : Enrichissement (toutes les catégories en dry-run).
    Retourne le rapport de recherche sans rien écrire en BDD.
    """
    from backend.main import app
    key_manager = getattr(app.state, "tavily_manager", None)
    if key_manager is None:
        raise HTTPException(status_code=500, detail="TavilyKeyManager non initialisé")

    import asyncio
    loop = asyncio.get_event_loop()

    if phase == "1":
        from backend.pipeline.phase1_research import run_phase1_research
        result = await loop.run_in_executor(
            None,
            run_phase1_research,
            school_id,
            key_manager,
            True  # dry_run = True
        )
        return result
    elif phase == "2":
        from backend.pipeline.phase2_research import run_phase2_research
        result = await loop.run_in_executor(
            None,
            run_phase2_research,
            school_id,
            key_manager,
            True  # dry_run = True
        )
        return result
    else:
        raise HTTPException(status_code=400, detail="Phase invalide (doit être '1' ou '2')")


# ── Fonctions de pipeline asynchrones ────────────────────────────

async def _run_scan(school_id: str, job_id: str):
    """
    Phase 1 réelle (Étape 5) — Tavily crawl + Gemma 31B + ContributionInbox INSERT.
    Tourne en arrière-plan via asyncio.create_task().
    """
    from backend.pipeline.phase1_research import run_phase1_research as run_phase1
    import asyncio

    _pipeline_jobs[school_id]["status"] = "running"
    logger.info(f"[job={job_id}] Phase 1 (scan) démarrée pour school_id={school_id}")

    update_progress(job_id, {
        "current_action": "Démarrage de la Phase 1",
        "school": school_id,
        "category": "Program_Discovery",
    })

    try:
        # Récupérer le TavilyKeyManager depuis app.state
        # (run_in_executor car run_phase1 est synchrone et bloquant)
        loop = asyncio.get_event_loop()

        # Importer app ici pour accéder à app.state.tavily_manager
        from backend.main import app
        key_manager = getattr(app.state, "tavily_manager", None)

        if key_manager is None:
            raise RuntimeError("TavilyKeyManager non initialisé")

        # Créer le callback de progression
        def progress_cb(details):
            update_progress(job_id, details)

        result = await loop.run_in_executor(
            None,
            lambda: run_phase1(school_id, key_manager, progress_callback=progress_cb),
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
    finally:
        _cleanup_progress(job_id)


async def _run_enrichment(school_id: str, job_id: str, categories: list[str]):
    """Phase 2 réelle (Étape 6) — Tavily search + Gemma extract par catégorie + Prisma insert."""
    from backend.pipeline.phase2_research import run_phase2_research as run_phase2
    import asyncio

    job_key = f"{school_id}:enrichment"
    _pipeline_jobs[job_key]["status"] = "running"
    logger.info(
        f"[job={job_id}] Phase 2 (enrichissement) démarrée pour "
        f"school_id={school_id}, catégories={categories}"
    )

    update_progress(job_id, {
        "current_action": "Démarrage de la Phase 2",
        "school": school_id,
    })

    try:
        loop = asyncio.get_event_loop()
        from backend.main import app
        key_manager = getattr(app.state, "tavily_manager", None)

        if key_manager is None:
            raise RuntimeError("TavilyKeyManager non initialisé")

        def progress_cb(details):
            update_progress(job_id, details)

        result = await loop.run_in_executor(
            None,
            lambda: run_phase2(school_id, key_manager, progress_callback=progress_cb),
        )

        _pipeline_jobs[job_key].update({
            "status": "completed" if result.get("success") else "failed",
            "result": result,
        })
        logger.info(f"[job={job_id}] Phase 2 terminée: {result.get('message') or 'Succès'}")

    except Exception as e:
        _pipeline_jobs[job_key]["status"] = "failed"
        _pipeline_jobs[job_key]["error"] = str(e)
        logger.error(f"[job={job_id}] Phase 2 erreur: {e}")
    finally:
        _cleanup_progress(job_id)


async def _run_targeted_research(
    school_id: str,
    job_id: str,
    job_key: str,
    phase: str,
    program_id: str | None,
    categories: list[str] | None,
):
    """
    Recherche ciblée depuis le panneau admin/cron.
    Utilise toujours le pipeline Research (USE_RESEARCH_PIPELINE=true).
    """
    import asyncio

    _pipeline_jobs[job_key]["status"] = "running"
    logger.info(
        f"[job={job_id}] Recherche ciblée démarrée — Phase {phase} "
        f"school_id={school_id}, program_id={program_id}, categories={categories}"
    )

    update_progress(job_id, {
        "current_action": f"Démarrage Phase {phase}",
        "school": school_id,
    })

    try:
        loop = asyncio.get_event_loop()
        from backend.main import app
        key_manager = getattr(app.state, "tavily_manager", None)

        if key_manager is None:
            raise RuntimeError("TavilyKeyManager non initialisé")

        def progress_cb(details):
            update_progress(job_id, details)

        if phase == "1":
            from backend.pipeline.phase1_research import run_phase1_research
            result = await loop.run_in_executor(
                None,
                lambda: run_phase1_research(
                    school_id, key_manager,
                    progress_callback=progress_cb
                ),
            )
        else:
            from backend.pipeline.phase2_research import run_phase2_research
            result = await loop.run_in_executor(
                None,
                lambda: run_phase2_research(
                    school_id, key_manager,
                    target_program_id=program_id,
                    target_categories=categories,
                    progress_callback=progress_cb,
                ),
            )

        _pipeline_jobs[job_key].update({
            "status": "completed" if result.get("success") else "failed",
            "result": result,
        })
        logger.info(f"[job={job_id}] Recherche ciblée terminée: {result.get('message') or 'Succès'}")

    except Exception as e:
        _pipeline_jobs[job_key]["status"] = "failed"
        _pipeline_jobs[job_key]["error"] = str(e)
        logger.error(f"[job={job_id}] Recherche ciblée erreur: {e}")
    finally:
        _cleanup_progress(job_id)
