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
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from backend import pipeline_jobs

logger = logging.getLogger("pipeline.internal")

router = APIRouter(prefix="/internal", tags=["internal"])
security = HTTPBearer()

# ── État du pipeline ──────────────────────────────────────────────
#
# Il vivait dans deux dictionnaires de module (_pipeline_jobs et
# _pipeline_progress). Il vit désormais dans la table PipelineJob, via
# backend/pipeline_jobs.py : il survit au redémarrage, se purge, et un job
# interrompu redevient détectable au lieu de verrouiller son école pour
# toujours. Voir la docstring de ce module pour le détail.

# ── Références des tâches de fond ─────────────────────────────────
#
# asyncio.create_task() ne conserve aucune référence forte : le ramasse-miettes
# peut collecter une tâche que plus personne ne tient et l'annuler en vol. Le
# job restait alors « running » à jamais. Motif standard : garder la tâche dans
# un set de module et l'en retirer à sa terminaison.
_background_tasks: set[asyncio.Task] = set()


def _spawn(coro) -> asyncio.Task:
    """Lance une tâche de fond en conservant sa référence."""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


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


# ── Garde de concurrence ──────────────────────────────────────────

def _already_running_response(school_id: str, message: str) -> dict | None:
    """
    Retourne la réponse « déjà en cours » si un job actif existe sur l'école.

    Les trois points d'entrée passent par ici : trigger-enrichment ne faisait
    aucun contrôle et réécrivait la clé existante, ce qui autorisait deux
    enrichissements concurrents sur la même école — crédits Tavily consommés en
    double et écritures rivales sur les mêmes lignes.

    Ce contrôle n'est sûr que parce que get_active_job() clôt d'abord les jobs
    morts : un verrou sans mécanisme d'expiration aggraverait le blocage.
    """
    active = pipeline_jobs.get_active_job(school_id)
    if active is None:
        return None
    return {
        "message": message,
        "job_id": active["job_id"],
        "status": active["status"],
        "phase": active["phase"],
        "already_running": True,
    }


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
    # Phase 1 uniquement. Faux par défaut : la collecte du rattachement campus
    # coûte 15 à 17 crédits Tavily et 9 appels Gemini par école, même quand
    # l'école ne publie rien. L'admin l'active passe par passe.
    collect_campus_attachments: bool = False


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
    already = _already_running_response(
        school_id, "Un scan est déjà en cours pour cette école"
    )
    if already:
        return already

    phase_label = pipeline_jobs.PHASE1_LABEL
    job_id = pipeline_jobs.create_job(
        school_id=school_id,
        phase=phase_label,
        source="manual",
        progress={"current_action": "En file d'attente", "priority": request.priority},
    )

    # Lancer en arrière-plan
    _spawn(_run_scan(school_id, job_id))

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
    already = _already_running_response(
        school_id, "Une tâche est déjà en cours pour cette école"
    )
    if already:
        return already

    phase_label = pipeline_jobs.PHASE2_LABEL
    job_id = pipeline_jobs.create_job(
        school_id=school_id,
        phase=phase_label,
        source="manual",
        progress={
            "current_action": "En file d'attente",
            "categories": request.categories,
            "force_refresh": request.force_refresh,
        },
    )

    _spawn(_run_enrichment(school_id, job_id, request.categories))

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
    # Validation avant toute écriture : un paramètre invalide ne doit pas créer
    # de ligne de job.
    if request.phase not in ("1", "2"):
        raise HTTPException(status_code=400, detail="Phase invalide (doit être '1' ou '2')")

    if request.phase == "2" and request.program_id and not request.categories:
        raise HTTPException(
            status_code=400,
            detail="Les catégories sont requises quand un programme est spécifié en Phase 2"
        )

    if request.collect_campus_attachments and request.phase != "1":
        raise HTTPException(
            status_code=400,
            detail="La collecte du rattachement campus ne concerne que la Phase 1"
        )

    already = _already_running_response(
        school_id, "Une tâche est déjà en cours pour cette école"
    )
    if already:
        return already

    phase_label = pipeline_jobs.PHASE1_LABEL if request.phase == "1" else pipeline_jobs.PHASE2_TARGETED_LABEL

    job_id = pipeline_jobs.create_job(
        school_id=school_id,
        phase=phase_label,
        source="manual",
        progress={
            "current_action": "En file d'attente",
            "program_id": request.program_id,
            "categories": request.categories,
            "collect_campus_attachments": request.collect_campus_attachments,
        },
    )

    _spawn(
        _run_targeted_research(
            school_id=school_id,
            job_id=job_id,
            phase=request.phase,
            program_id=request.program_id,
            categories=request.categories,
            collect_campus_attachments=request.collect_campus_attachments,
        )
    )

    logger.info(
        f"🚀 Recherche ciblée déclenchée pour school_id={school_id} "
        f"(phase={request.phase}, program={request.program_id}, categories={request.categories}, "
        f"collect_campus_attachments={request.collect_campus_attachments})"
    )
    return {
        "message": "Recherche ciblée déclenchée",
        "job_id": job_id,
        "school_id": school_id,
        "phase": phase_label,
        "program_id": request.program_id,
        "categories": request.categories,
        # Renvoyé pour que l'écran admin affiche ce que le backend a compris :
        # un backend antérieur à l'interrupteur ignorerait le champ et
        # lancerait la collecte à chaque passe.
        "collect_campus_attachments": request.collect_campus_attachments,
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

    # Les jobs viennent de la base. list_active_jobs() clôt au passage ceux qui
    # n'ont plus donné signe de vie : la supervision est le bon endroit pour
    # faire ce ménage, elle est appelée en boucle par le panneau admin.
    jobs_error = None
    try:
        active_jobs = pipeline_jobs.list_active_jobs(limit=20)
        pipeline_jobs.purge_finished_jobs()
    except Exception as e:
        logger.error(f"❌ Lecture de l'état des jobs impossible: {e}")
        active_jobs = []
        jobs_error = str(e)

    manual_jobs = [job for job in active_jobs if job.get("source", "manual") != "cron"]
    cron_jobs = [job for job in active_jobs if job.get("source") == "cron"]

    # Un job periodique en echec degrade le pipeline, meme si la BDD repond.
    scheduler_failed = bool(scheduler_status.get("has_failure")) or bool(
        scheduler_status.get("error")
    )

    return {
        "status": "ok" if (db_ok and not scheduler_failed and not jobs_error) else "degraded",
        "database": "connected" if db_ok else "disconnected",
        "scheduler": scheduler_status,
        "pipeline_jobs_active": len(manual_jobs) + len(cron_jobs),
        "pipeline_jobs": manual_jobs[:10],  # Limiter à 10 pour la lisibilité
        "cron_jobs": cron_jobs[:10],        # Limiter à 10 pour la lisibilité
        "jobs_error": jobs_error,
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
    Tourne en arrière-plan via _spawn().
    """
    from backend.pipeline.phase1_research import run_phase1_research as run_phase1

    pipeline_jobs.mark_running(job_id)
    logger.info(f"[job={job_id}] Phase 1 (scan) démarrée pour school_id={school_id}")

    pipeline_jobs.update_progress(job_id, {
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
            pipeline_jobs.update_progress(job_id, details)

        result = await loop.run_in_executor(
            None,
            lambda: run_phase1(school_id, key_manager, progress_callback=progress_cb),
        )

        pipeline_jobs.complete_job(
            job_id,
            "completed" if result.get("success") else "failed",
            result=result,
            error=None if result.get("success") else result.get("message"),
        )
        logger.info(f"[job={job_id}] Phase 1 terminée: {result.get('message')}")

    except Exception as e:
        pipeline_jobs.complete_job(job_id, "failed", error=str(e))
        logger.error(f"[job={job_id}] Phase 1 erreur: {e}")


async def _run_enrichment(school_id: str, job_id: str, categories: list[str]):
    """Phase 2 réelle (Étape 6) — Tavily search + Gemma extract par catégorie + Prisma insert."""
    from backend.pipeline.phase2_research import run_phase2_research as run_phase2

    pipeline_jobs.mark_running(job_id)
    logger.info(
        f"[job={job_id}] Phase 2 (enrichissement) démarrée pour "
        f"school_id={school_id}, catégories={categories}"
    )

    pipeline_jobs.update_progress(job_id, {
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
            pipeline_jobs.update_progress(job_id, details)

        result = await loop.run_in_executor(
            None,
            lambda: run_phase2(school_id, key_manager, progress_callback=progress_cb),
        )

        pipeline_jobs.complete_job(
            job_id,
            "completed" if result.get("success") else "failed",
            result=result,
            error=None if result.get("success") else result.get("message"),
        )
        logger.info(f"[job={job_id}] Phase 2 terminée: {result.get('message') or 'Succès'}")

    except Exception as e:
        pipeline_jobs.complete_job(job_id, "failed", error=str(e))
        logger.error(f"[job={job_id}] Phase 2 erreur: {e}")


async def _run_targeted_research(
    school_id: str,
    job_id: str,
    phase: str,
    program_id: str | None,
    categories: list[str] | None,
    collect_campus_attachments: bool = False,
):
    """
    Recherche ciblée depuis le panneau admin/cron.
    Utilise toujours le pipeline Research (USE_RESEARCH_PIPELINE=true).
    """
    pipeline_jobs.mark_running(job_id)
    logger.info(
        f"[job={job_id}] Recherche ciblée démarrée — Phase {phase} "
        f"school_id={school_id}, program_id={program_id}, categories={categories}"
    )

    pipeline_jobs.update_progress(job_id, {
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
            pipeline_jobs.update_progress(job_id, details)

        if phase == "1":
            from backend.pipeline.phase1_research import run_phase1_research
            result = await loop.run_in_executor(
                None,
                lambda: run_phase1_research(
                    school_id, key_manager,
                    progress_callback=progress_cb,
                    collect_campus_attachments=collect_campus_attachments,
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

        pipeline_jobs.complete_job(
            job_id,
            "completed" if result.get("success") else "failed",
            result=result,
            error=None if result.get("success") else result.get("message"),
        )
        logger.info(f"[job={job_id}] Recherche ciblée terminée: {result.get('message') or 'Succès'}")

    except Exception as e:
        pipeline_jobs.complete_job(job_id, "failed", error=str(e))
        logger.error(f"[job={job_id}] Recherche ciblée erreur: {e}")
