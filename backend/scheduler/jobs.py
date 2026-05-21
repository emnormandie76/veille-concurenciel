"""
backend/scheduler/jobs.py — APScheduler Jobs (Étape 5.4)

Deux jobs récurrents :
  - phase1_scanner : toutes les CRON_PHASE1_INTERVAL_HOURS heures
    Détecte les écoles ACTIVE sans Campus → lance run_phase1()
  - phase2_enricher : toutes les CRON_PHASE2_INTERVAL_HOURS heures (Étape 6)
    Détecte les Programs validés → lance run_phase2() pour chaque catégorie

Règles :
  - Max 1 école à la fois (pas de parallélisme → économie Free Tier)
  - Pause de 30s entre deux écoles
  - Le scheduler est démarré/arrêté dans le lifespan FastAPI (main.py)

Référence : task.md §5.4, architecture.md §2.2 (APScheduler)
"""

import os
import logging
import time
import psycopg2
import psycopg2.extras

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from backend.tavily_service.key_manager import QuotaExhaustedError

logger = logging.getLogger("pipeline.scheduler")

# ── Constantes ────────────────────────────────────────────────────
PHASE1_INTERVAL_HOURS = int(os.environ.get("CRON_PHASE1_INTERVAL_HOURS", 168))  # 1 semaine
PHASE2_INTERVAL_HOURS = int(os.environ.get("CRON_PHASE2_INTERVAL_HOURS", 24))   # 1 jour
PAUSE_BETWEEN_SCHOOLS = 30  # secondes entre chaque école (politesse + rate limits)

# ── Singleton scheduler ───────────────────────────────────────────
_scheduler: BackgroundScheduler | None = None


def get_scheduler() -> BackgroundScheduler:
    """Retourne le scheduler (singleton)."""
    global _scheduler
    if _scheduler is None:
        _scheduler = BackgroundScheduler(
            timezone="Europe/Paris",
            job_defaults={
                "coalesce": True,    # Fusionner les jobs manqués (Koyeb redémarrages)
                "max_instances": 1,  # Une seule instance à la fois
            }
        )
    return _scheduler


# ── Job Phase 1 : Scanner ─────────────────────────────────────────

def phase1_scanner(key_manager):
    """
    Job APScheduler : Phase 1 — Cartographie (Program Discovery)

    Détecte les écoles ACTIVE sans Campus en BDD et lance run_phase1() pour chacune.
    Traitement séquentiel avec pause entre chaque école.

    Référence : task.md §5.4, architecture.md §5.1
    """
    from backend.db import get_db_connection
    from backend.pipeline.phase1 import run_phase1

    logger.info(f"⏰ [CRON] phase1_scanner démarré")

    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                # Écoles ACTIVE sans aucun Campus
                cur.execute(
                    """
                    SELECT s.id, s.name, s.official_domain
                    FROM "School" s
                    LEFT JOIN "Campus" c ON c."schoolId" = s.id
                    WHERE s.status = 'ACTIVE'
                    AND c.id IS NULL
                    ORDER BY s."createdAt" ASC
                    """
                )
                schools_without_campus = cur.fetchall()

    except Exception as e:
        logger.error(f"❌ [CRON] Erreur lecture BDD dans phase1_scanner: {e}")
        return

    if not schools_without_campus:
        logger.info("✅ [CRON] phase1_scanner: aucune école à traiter")
        return

    logger.info(
        f"📋 [CRON] phase1_scanner: {len(schools_without_campus)} école(s) sans campus"
    )

    for i, school in enumerate(schools_without_campus):
        school_id = school["id"]
        school_name = school["name"]

        logger.info(
            f"🏫 [CRON] Traitement {i+1}/{len(schools_without_campus)}: {school_name}"
        )

        try:
            result = run_phase1(school_id, key_manager)

            if result.get("success"):
                logger.info(
                    f"✅ [CRON] {school_name}: "
                    f"{result.get('campuses_count')} campus, "
                    f"{result.get('programs_count')} programmes → Inbox créé"
                )
            else:
                msg = result.get("message", "Échec inconnu")
                logger.warning(f"⚠️ [CRON] {school_name}: {msg}")

                # Si quota épuisé → arrêter le job immédiatement
                if "quota" in msg.lower() or "épuisé" in msg.lower():
                    logger.error("🛑 [CRON] Quota Tavily épuisé — arrêt du scanner")
                    break

        except QuotaExhaustedError as e:
            logger.error(f"🛑 [CRON] Quota Tavily épuisé — arrêt immédiat du scanner: {e}")
            break
        except Exception as e:
            logger.error(f"❌ [CRON] Erreur lors du traitement de {school_name}: {e}")

        # Pause entre chaque école (sauf la dernière)
        if i < len(schools_without_campus) - 1:
            logger.info(f"⏸️ [CRON] Pause {PAUSE_BETWEEN_SCHOOLS}s avant la prochaine école...")
            time.sleep(PAUSE_BETWEEN_SCHOOLS)

    logger.info("✅ [CRON] phase1_scanner terminé")


# ── Job Phase 2 : Enricher (stub — Étape 6) ──────────────────────

def phase2_enricher(key_manager):
    """
    Job APScheduler : Phase 2 — Enrichissement

    Détecte les écoles ACTIVE avec au moins un Campus et lance run_phase2() pour chacune.
    Traitement séquentiel avec pause entre chaque école.

    Référence : task.md §6.5, architecture.md §5.3
    """
    from backend.db import get_db_connection
    from backend.pipeline.phase2 import run_phase2

    logger.info(f"⏰ [CRON] phase2_enricher démarré")

    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                # Écoles ACTIVE avec au moins un Campus
                cur.execute(
                    """
                    SELECT DISTINCT s.id, s.name
                    FROM "School" s
                    JOIN "Campus" c ON c."schoolId" = s.id
                    WHERE s.status = 'ACTIVE'
                    ORDER BY s.name ASC
                    """
                )
                schools_with_campus = cur.fetchall()

    except Exception as e:
        logger.error(f"❌ [CRON] Erreur lecture BDD dans phase2_enricher: {e}")
        return

    if not schools_with_campus:
        logger.info("✅ [CRON] phase2_enricher: aucune école à traiter")
        return

    logger.info(
        f"📋 [CRON] phase2_enricher: {len(schools_with_campus)} école(s) à enrichir"
    )

    for i, school in enumerate(schools_with_campus):
        school_id = school["id"]
        school_name = school["name"]

        logger.info(
            f"🏫 [CRON] Traitement {i+1}/{len(schools_with_campus)}: {school_name}"
        )

        try:
            result = run_phase2(school_id, key_manager)

            if result.get("success"):
                logger.info(
                    f"✅ [CRON] {school_name}: {result.get('tickets_created')} ticket(s) créé(s)"
                )
            else:
                msg = result.get("message", "Échec inconnu")
                logger.warning(f"⚠️ [CRON] {school_name}: {msg}")

                if "quota" in msg.lower() or "épuisé" in msg.lower():
                    logger.error("🛑 [CRON] Quota Tavily épuisé — arrêt de l'enricher")
                    break

        except QuotaExhaustedError as e:
            logger.error(f"🛑 [CRON] Quota Tavily épuisé — arrêt immédiat de l'enricher: {e}")
            break
        except Exception as e:
            logger.error(f"❌ [CRON] Erreur lors du traitement de {school_name}: {e}")

        if i < len(schools_with_campus) - 1:
            logger.info(f"⏸️ [CRON] Pause {PAUSE_BETWEEN_SCHOOLS}s avant la prochaine école...")
            time.sleep(PAUSE_BETWEEN_SCHOOLS)

    logger.info("✅ [CRON] phase2_enricher terminé")


# ── Démarrage / Arrêt ─────────────────────────────────────────────

def start_scheduler(key_manager):
    """
    Démarre le scheduler avec les deux jobs et le traitement Crowdsourcing.
    Appelé depuis le lifespan FastAPI (main.py) au startup.
    """
    scheduler = get_scheduler()

    if scheduler.running:
        logger.warning("⚠️ Scheduler déjà en cours — skip")
        return

    # ── Job Phase 1 ──────────────────────────────────────────────
    scheduler.add_job(
        func=phase1_scanner,
        trigger=IntervalTrigger(hours=PHASE1_INTERVAL_HOURS),
        args=[key_manager],
        id="phase1_scanner",
        name=f"Phase 1 Scanner (toutes les {PHASE1_INTERVAL_HOURS}h)",
        replace_existing=True,
    )

    # ── Job Phase 2 ──────────────────────────────────────────────
    scheduler.add_job(
        func=phase2_enricher,
        trigger=IntervalTrigger(hours=PHASE2_INTERVAL_HOURS),
        args=[key_manager],
        id="phase2_enricher",
        name=f"Phase 2 Enricher (toutes les {PHASE2_INTERVAL_HOURS}h)",
        replace_existing=True,
    )

    # ── Job Crowdsourcing ────────────────────────────────────────
    from backend.crowdsourcing.processor import process_pending_submissions
    scheduler.add_job(
        func=process_pending_submissions,
        trigger=IntervalTrigger(minutes=5),
        args=[key_manager],
        id="crowdsourcing_processor",
        name="Process Crowdsourcing Submissions (toutes les 5m)",
        replace_existing=True,
    )

    scheduler.start()
    logger.info(
        f"✅ Scheduler démarré: "
        f"Phase1({PHASE1_INTERVAL_HOURS}h), Phase2({PHASE2_INTERVAL_HOURS}h), Crowdsourcing(5m)"
    )


def stop_scheduler():
    """
    Arrête le scheduler proprement.
    Appelé depuis le lifespan FastAPI (main.py) au shutdown.
    """
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("✅ Scheduler arrêté")
    _scheduler = None


def get_scheduler_status() -> dict:
    """Retourne le statut du scheduler (pour pipeline-status)."""
    scheduler = _scheduler
    if not scheduler or not scheduler.running:
        return {"running": False, "jobs": []}

    jobs = []
    for job in scheduler.get_jobs():
        next_run = job.next_run_time
        jobs.append({
            "id": job.id,
            "name": job.name,
            "next_run": next_run.isoformat() if next_run else None,
        })

    return {"running": True, "jobs": jobs}
