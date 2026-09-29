"""
backend/scheduler/jobs.py — APScheduler Jobs

Deux jobs récurrents :
  - research_rotation : chaque nuit à CRON_RESEARCH_HOUR (Europe/Paris), au
    plus CRON_ROTATION_PASSES_PER_NIGHT passe(s) Phase 1 ou Phase 2, choisies
    par le planificateur (scheduler/rotation.py) sous le plafond mensuel
    CRON_MONTHLY_CREDIT_CEILING. Seul job qui paie Research.
  - crowdsourcing_processor : toutes les CRON_CROWDSOURCING_INTERVAL_MINUTES.

Règles :
  - Le scheduler est démarré/arrêté dans le lifespan FastAPI (main.py)
  - Hors production, research_rotation n'est PAS inscrit : voir
    research_cron_enabled(). Le traitement Crowdsourcing l'est toujours.

## Pourquoi une rotation à heure fixe

phase1_scanner et phase2_enricher, qu'elle remplace, tournaient sur des
IntervalTrigger comptés depuis le démarrage : sur Koyeb, qui redémarre, la
Phase 1 partait à chaque redémarrage et la Phase 2 jamais. Et la Phase 2
repassait chaque jour sur tout (~54 000 crédits par mois pour trois écoles).
Le CronTrigger ne dépend pas du démarrage ; misfire_grace_time rattrape une
nuit où l'instance était arrêtée à l'heure dite.

Référence : docs/features/cron-rotation-production.md, architecture.md §2.2
"""

import os
import logging
from dataclasses import dataclass
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from backend import pipeline_jobs
from backend.tavily_service.key_manager import QuotaExhaustedError
from backend.utils.env import env_int

logger = logging.getLogger("pipeline.scheduler")

# ── Constantes ────────────────────────────────────────────────────
ROTATION_JOB_ID = "research_rotation"
ROTATION_TIMEZONE = "Europe/Paris"

# Lues une fois, au démarrage. Une valeur illisible retombe sur le défaut.
RESEARCH_HOUR = env_int("CRON_RESEARCH_HOUR", 3, minimum=0, maximum=23)
# 0 : le job planifie et journalise, mais ne dépense rien (vérification à blanc).
MONTHLY_CREDIT_CEILING = env_int("CRON_MONTHLY_CREDIT_CEILING", 7000, minimum=0)
PASSES_PER_NIGHT = env_int("CRON_ROTATION_PASSES_PER_NIGHT", 1, minimum=1)

# Le libellé du job et le log de démarrage annonçaient 5 minutes alors que le
# déclencheur était réglé sur 1. C'est l'intervalle réel qui fait foi ici.
CROWDSOURCING_INTERVAL_MINUTES = int(
    os.environ.get("CRON_CROWDSOURCING_INTERVAL_MINUTES", 1)
)

# Valeurs reconnues pour CRON_RESEARCH_ENABLED.
_TRUTHY = frozenset({"1", "true", "yes", "on"})
_FALSY = frozenset({"0", "false", "no", "off"})


def research_cron_enabled() -> tuple[bool, str]:
    """
    Le job qui PAIE Research (research_rotation) doit-il etre inscrit ?

    Rend `(active, raison)`, la raison etant journalisee au demarrage.

    Lancer le backend sur un poste de developpement demarrait phase1_scanner,
    qui passait 5 minutes plus tard sur toutes les ecoles ACTIVE sans campus :
    le 2026-09-28, EMLV et Essec, environ 28 a 30 credits Tavily chacune, sans
    que personne n'ait clique. research_rotation, qui l'a remplace avec
    phase2_enricher, paie Research de la meme facon. Il ne doit pas tourner
    parce qu'un developpeur a demarre uvicorn.

    Par defaut, il n'est donc inscrit qu'en production (`ENVIRONMENT`,
    deja [PROD — REQUIS], voir .env.example). `CRON_RESEARCH_ENABLED` force
    l'un ou l'autre choix. Une valeur non reconnue desactive, bruyamment : une
    faute de frappe doit couter une passe de cron, pas des credits.

    Le traitement Crowdsourcing n'est pas concerne : il n'agit que sur des
    tickets que quelqu'un a deposes.
    """
    raw = os.environ.get("CRON_RESEARCH_ENABLED", "").strip().lower()
    if raw in _TRUTHY:
        return True, "CRON_RESEARCH_ENABLED=%s" % raw
    if raw in _FALSY:
        return False, "CRON_RESEARCH_ENABLED=%s" % raw
    if raw:
        return False, (
            "CRON_RESEARCH_ENABLED=%r non reconnue (attendu true/false) : "
            "jobs Research desactives par prudence" % raw
        )
    environment = os.environ.get("ENVIRONMENT", "development").strip().lower()
    if environment in ("production", "prod"):
        return True, "ENVIRONMENT=%s" % environment
    return False, (
        "ENVIRONMENT=%s : hors production, les jobs Research ne sont pas "
        "inscrits (CRON_RESEARCH_ENABLED=true pour les forcer)" % environment
    )

# ── Registre du dernier passage de chaque job ─────────────────────
# Un job périodique qui échoue ne doit pas se contenter d'une ligne de log :
# du point de vue d'APScheduler il se termine « normalement » et le panneau
# admin n'affiche aucune anomalie. Ce registre est exposé par
# get_scheduler_status(), lui-même remonté dans /internal/pipeline-status.
_last_job_runs: dict[str, dict] = {}


def _record_job_run(job_id: str, status: str, detail: str | None = None) -> None:
    """Enregistre l'issue du dernier passage d'un job ('success' ou 'failed')."""
    _last_job_runs[job_id] = {
        "status": status,
        "detail": detail,
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }


# ── Suivi des jobs cron dans la table PipelineJob ───────────────
#
# Auparavant register_cron_job()/complete_cron_job(), qui écrivaient dans le
# dictionnaire de module de routers/internal.py. L'état vit maintenant en base.
# Le suivi ne doit jamais faire tomber le cron : si la base ne répond pas, le
# traitement continue sans job tracé (run_phase1 échouera de lui-même si la
# base est vraiment indisponible).

def _start_cron_job(school_id: str, phase: str) -> str | None:
    """Ouvre un job cron en base. Retourne son id, ou None si l'écriture échoue."""
    try:
        job_id = pipeline_jobs.create_job(school_id, phase, source="cron")
        pipeline_jobs.mark_running(job_id)
        return job_id
    except Exception as e:
        logger.warning(f"⚠️ [CRON] Job non enregistré en base pour {school_id}: {e}")
        return None


def _finish_cron_job(job_id: str | None, status: str, result=None, error=None) -> None:
    """Clôt un job cron en base, si son ouverture avait réussi."""
    if not job_id:
        return
    try:
        pipeline_jobs.complete_job(job_id, status, result=result, error=error)
    except Exception as e:
        logger.warning(f"⚠️ [CRON] Clôture du job {job_id} non enregistrée: {e}")


def _school_is_busy(school_id: str) -> bool:
    """
    Vrai si un job tourne déjà sur cette école (déclenché à la main, ou par le
    passage précédent). Empeche le cron de doubler un traitement en cours et de
    consommer deux fois les crédits Tavily.
    """
    try:
        return pipeline_jobs.get_active_job(school_id) is not None
    except Exception as e:
        # Base injoignable : on ne bloque pas le cron sur un contrôle de confort.
        logger.warning(f"⚠️ [CRON] Contrôle de concurrence impossible ({e})")
        return False

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


# ── Job nocturne : rotation des recherches ────────────────────────

class _QuotaWatch:
    """
    Le TavilyKeyManager, vu par une passe : note tout refus de clé.

    Les phases avalent QuotaExhaustedError — la Phase 1 en fait un échec
    motivé, la Phase 2 une ligne de journal par cible, avant de passer à la
    suivante. Une Phase 2 coupée par le quota se terminerait donc « réussie »,
    et l'école attendrait six mois ce qu'elle n'a pas reçu. Le refus se lit
    ici, au seul endroit où toute clé est demandée.
    """

    def __init__(self, key_manager):
        self._key_manager = key_manager
        self.refused = False

    def get_active_key(self, *args, **kwargs):
        try:
            return self._key_manager.get_active_key(*args, **kwargs)
        except QuotaExhaustedError:
            self.refused = True
            raise

    def __getattr__(self, name):
        return getattr(self._key_manager, name)


@dataclass
class _PassOutcome:
    status: str                  # "completed" | "failed" | "busy" | "not_recorded"
    error: str | None = None
    quota_exhausted: bool = False


_QUOTA_CUT_ERROR = (
    "Quota Tavily épuisé pendant la passe : passe incomplète, reprise après "
    "le délai d'échec (CRON_RESEARCH_RETRY_FAILED_DAYS)"
)


def _describe(candidate) -> str:
    return (
        f"{candidate.school_name}, Phase {candidate.phase}, "
        f"~{candidate.estimated_credits} crédits"
    )


def _run_rotation_pass(candidate, key_manager) -> _PassOutcome:
    """
    Une passe de la rotation, tracée comme un PipelineJob `source = "cron"`.

    Le job EST la mémoire du passage (rotation.py) : s'il ne peut pas être
    ouvert, la passe n'est pas lancée — sinon l'école serait repayée la nuit
    suivante. Il porte un battement de cœur : une passe muette plus de
    PIPELINE_JOB_STALE_SECONDS serait déclarée morte en cours de route.
    """
    from backend.pipeline.phase1_research import run_phase1_research
    from backend.pipeline.phase2_research import run_phase2_research
    from backend.scheduler.rotation import PHASE_1

    if _school_is_busy(candidate.school_id):
        logger.info(f"⏭️ [ROTATION] {candidate.school_name} : un job est déjà en cours — passée")
        return _PassOutcome("busy")

    phase_label = (
        pipeline_jobs.PHASE1_CRON_LABEL if candidate.phase == PHASE_1
        else pipeline_jobs.PHASE2_CRON_LABEL
    )
    job_id = _start_cron_job(candidate.school_id, phase_label)
    if job_id is None:
        return _PassOutcome("not_recorded", "job non enregistré en base : passe non lancée")

    def progress(details: dict) -> None:
        pipeline_jobs.update_progress(job_id, details)

    watch = _QuotaWatch(key_manager)
    logger.info(f"🚀 [ROTATION] {_describe(candidate)} ({candidate.reason})")
    try:
        if candidate.phase == PHASE_1:
            # Jamais de collecte du rattachement campus depuis le cron
            # (architecture.md §5.4) : ~15 crédits par école, souvent pour rien.
            result = run_phase1_research(
                candidate.school_id, watch,
                progress_callback=progress,
                collect_campus_attachments=False,
            )
        else:
            result = run_phase2_research(
                candidate.school_id, watch,
                progress_callback=progress,
                skip_pending=True,
            )
    except QuotaExhaustedError as e:
        _finish_cron_job(job_id, pipeline_jobs.STATUS_FAILED, error=str(e))
        return _PassOutcome(pipeline_jobs.STATUS_FAILED, str(e), quota_exhausted=True)
    except Exception as e:
        logger.error(f"❌ [ROTATION] {_describe(candidate)} : {e}")
        _finish_cron_job(job_id, pipeline_jobs.STATUS_FAILED, error=str(e))
        return _PassOutcome(pipeline_jobs.STATUS_FAILED, str(e))

    if watch.refused or key_manager.available_keys == 0:
        logger.error(f"🛑 [ROTATION] {_describe(candidate)} : {_QUOTA_CUT_ERROR}")
        _finish_cron_job(job_id, pipeline_jobs.STATUS_FAILED, result=result, error=_QUOTA_CUT_ERROR)
        return _PassOutcome(pipeline_jobs.STATUS_FAILED, _QUOTA_CUT_ERROR, quota_exhausted=True)

    if result.get("success"):
        logger.info(f"✅ [ROTATION] {_describe(candidate)} : {result.get('message')}")
        _finish_cron_job(job_id, pipeline_jobs.STATUS_COMPLETED, result=result)
        return _PassOutcome(pipeline_jobs.STATUS_COMPLETED)

    message = result.get("message") or "Échec inconnu"
    logger.warning(f"⚠️ [ROTATION] {_describe(candidate)} : {message}")
    _finish_cron_job(job_id, pipeline_jobs.STATUS_FAILED, error=message)
    return _PassOutcome(pipeline_jobs.STATUS_FAILED, message)


def research_rotation(key_manager, now: datetime | None = None) -> None:
    """
    Job APScheduler nocturne : au plus PASSES_PER_NIGHT passe(s), sous plafond.

    Lit l'état, planifie (rotation.plan_rotation), puis lance le PREMIER
    candidat dont l'estimation tient sous MONTHLY_CREDIT_CEILING avec les
    crédits déjà consommés ce mois-ci. Aucun candidat ne tient : rien ce soir,
    et le registre le dit. Un quota épuisé clôt la nuit.
    """
    from backend.db import get_db_connection
    from backend.scheduler.rotation import load_rotation_state, plan_rotation

    logger.info("⏰ [ROTATION] research_rotation démarré")

    if key_manager is None:
        logger.error("❌ [ROTATION] Aucun TavilyKeyManager : rotation abandonnée")
        _record_job_run(ROTATION_JOB_ID, "failed", "TavilyKeyManager absent : aucune clé chargée")
        return

    try:
        # Un job mort encore marqué actif ferait sauter son école ce soir.
        pipeline_jobs.reap_stale_jobs()
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                state = load_rotation_state(cur)
        candidates = plan_rotation(
            state.schools, state.last_passes, state.discovery_pending,
            now or datetime.now(timezone.utc),
        )
        used = key_manager.credits_used_this_month()
    except Exception as e:
        logger.error(f"❌ [ROTATION] Planification impossible : {e}")
        _record_job_run(ROTATION_JOB_ID, "failed", f"planification : {e}")
        return

    logger.info(
        f"📋 [ROTATION] {len(candidates)} passe(s) due(s) ; crédits du mois "
        f"{used}/{MONTHLY_CREDIT_CEILING} ; en tête : "
        + (", ".join(f"{_describe(c)} ({c.reason})" for c in candidates[:5]) or "—")
    )
    if not candidates:
        _record_job_run(ROTATION_JOB_ID, "success", "aucune passe due")
        return

    if not any(used + c.estimated_credits <= MONTHLY_CREDIT_CEILING for c in candidates):
        detail = (
            f"plafond mensuel atteint : {used}/{MONTHLY_CREDIT_CEILING} crédits, "
            f"{len(candidates)} passe(s) en attente, la moins chère "
            f"~{min(c.estimated_credits for c in candidates)} crédits"
        )
        logger.info(f"⏸️ [ROTATION] {detail}")
        _record_job_run(ROTATION_JOB_ID, "success", detail)
        return

    launched: list[tuple] = []
    for candidate in candidates:
        if len(launched) >= PASSES_PER_NIGHT:
            break
        if used + candidate.estimated_credits > MONTHLY_CREDIT_CEILING:
            logger.info(f"⏭️ [ROTATION] {_describe(candidate)} : ne tient pas sous le plafond")
            continue

        outcome = _run_rotation_pass(candidate, key_manager)
        if outcome.status == "busy":
            continue
        launched.append((candidate, outcome))
        if outcome.quota_exhausted or outcome.status == "not_recorded":
            break
        used = key_manager.credits_used_this_month()

    if not launched:
        _record_job_run(ROTATION_JOB_ID, "success", "aucune passe lancée : écoles occupées")
        return

    failed = [o for _, o in launched if o.status != pipeline_jobs.STATUS_COMPLETED]
    detail = " ; ".join(
        _describe(c) + (f" — {o.error}" if o.error else "") for c, o in launched
    )
    _record_job_run(ROTATION_JOB_ID, "failed" if failed else "success", detail)


# ── Démarrage / Arrêt ─────────────────────────────────────────────

def start_scheduler(key_manager):
    """
    Démarre le scheduler : la rotation des recherches (production seulement) et
    le traitement Crowdsourcing. Appelé depuis le lifespan FastAPI (main.py).
    """
    scheduler = get_scheduler()

    if scheduler.running:
        logger.warning("⚠️ Scheduler déjà en cours — skip")
        return

    research_enabled, research_reason = research_cron_enabled()

    if research_enabled:
        # Heure fixe, indépendante du démarrage : voir l'en-tête du module.
        scheduler.add_job(
            func=research_rotation,
            trigger=CronTrigger(hour=RESEARCH_HOUR, minute=0, timezone=ROTATION_TIMEZONE),
            args=[key_manager],
            id=ROTATION_JOB_ID,
            name=f"Rotation des recherches (chaque nuit à {RESEARCH_HOUR}h)",
            misfire_grace_time=3600,
            coalesce=True,
            max_instances=1,
            replace_existing=True,
        )
    else:
        logger.warning(f"⏸️ Rotation des recherches non inscrite — {research_reason}")

    # ── Job Crowdsourcing ────────────────────────────────────────
    from backend.crowdsourcing.processor import process_pending_submissions
    scheduler.add_job(
        func=process_pending_submissions,
        trigger=IntervalTrigger(minutes=CROWDSOURCING_INTERVAL_MINUTES),
        args=[key_manager],
        id="crowdsourcing_processor",
        name=f"Process Crowdsourcing Submissions (toutes les {CROWDSOURCING_INTERVAL_MINUTES}m)",
        replace_existing=True,
    )

    scheduler.start()
    research_part = (
        f"Rotation({RESEARCH_HOUR}h {ROTATION_TIMEZONE}, {PASSES_PER_NIGHT} passe(s) par nuit, "
        f"plafond {MONTHLY_CREDIT_CEILING} crédits/mois), "
        if research_enabled
        else "Rotation désactivée, "
    )
    logger.info(
        f"✅ Scheduler démarré ({research_reason}): "
        f"{research_part}"
        f"Crowdsourcing({CROWDSOURCING_INTERVAL_MINUTES}m)"
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
        return {"running": False, "jobs": [], "last_runs": dict(_last_job_runs)}

    jobs = []
    for job in scheduler.get_jobs():
        next_run = job.next_run_time
        jobs.append({
            "id": job.id,
            "name": job.name,
            "next_run": next_run.isoformat() if next_run else None,
            "last_run": _last_job_runs.get(job.id),
        })

    return {
        "running": True,
        "jobs": jobs,
        "last_runs": dict(_last_job_runs),
        # Vrai des qu'un job periodique a echoue a son dernier passage : c'est
        # ce drapeau que le panneau admin doit surveiller.
        "has_failure": any(
            run.get("status") == "failed" for run in _last_job_runs.values()
        ),
        # Pourquoi research_rotation manque a `jobs`, le cas echeant :
        # l'absence doit se lire, pas se deviner.
        "research_cron": dict(zip(("enabled", "reason"), research_cron_enabled())),
    }
