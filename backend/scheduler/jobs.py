"""
backend/scheduler/jobs.py — Passes dues et traitement des contributions

Deux points d'entrée :
  - run_due_passes : les passes de recherche dues (Phase 1 ou Phase 2),
    choisies par le planificateur (scheduler/rotation.py) sous le plafond
    mensuel CRON_MONTHLY_CREDIT_CEILING. Lancé à la demande de l'admin, par
    POST /internal/run-due-passes. AUCUN job planifié ne paie Research.
  - crowdsourcing_processor : le seul job APScheduler. Toutes les
    CRON_CROWDSOURCING_INTERVAL_MINUTES tant que le backend tourne, première
    passe dès le démarrage pour traiter l'arriéré `Pending_AI`.

Le scheduler est démarré/arrêté dans le lifespan FastAPI (main.py).

## Pourquoi plus de cron

Le backend n'est plus hébergé : l'admin le lance à la main sur son poste
(décision du 14 octobre 2026). Un cron à heure fixe ne tournerait que si le
poste est allumé à cette heure-là. Et lancer uvicorn ne doit jamais suffire à
payer Research : le 28 septembre 2026, un démarrage local avait lancé deux
Phase 1 payantes sans que personne ait cliqué. Les passes dues partent donc sur
demande, avec la logique de l'ancien cron `research_rotation` : mêmes libellés
de job (la mémoire des passages), même plafond, même garde « école occupée »,
même arrêt sur quota.

Référence : docs/features/backend-local.md (étape 3), architecture.md §5.5
"""

import copy
import logging
import threading
from dataclasses import dataclass
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from backend import pipeline_jobs
from backend.tavily_service.key_manager import QuotaExhaustedError
from backend.utils.env import env_int

logger = logging.getLogger("pipeline.scheduler")

# ── Constantes ────────────────────────────────────────────────────
# Clés du registre des passages (_last_job_runs). La simulation a la sienne :
# elle n'efface pas l'issue de la dernière exécution réelle.
ROTATION_JOB_ID = "run_due_passes"
DRY_RUN_JOB_ID = "run_due_passes_dry_run"
CROWDSOURCING_JOB_ID = "crowdsourcing_processor"

# Passes lancées par une exécution, au plus (POST /internal/run-due-passes).
MAX_PASSES_PER_RUN = 5

# Lu une fois, au démarrage. Une valeur illisible retombe sur le défaut.
MONTHLY_CREDIT_CEILING = env_int("CRON_MONTHLY_CREDIT_CEILING", 7000, minimum=0)

CROWDSOURCING_DEFAULT_INTERVAL_MINUTES = 1

# Statut d'un rapport annoncé avant le départ des passes (on_planned).
REPORT_PLANNED = "planned"


class RotationAlreadyRunning(RuntimeError):
    """Une exécution réelle des passes dues tourne déjà dans ce processus."""

    code = "ALREADY_RUNNING"


class UsageSyncFailed(RuntimeError):
    """La synchro /usage n'a pas recalé toutes les clés : aucune passe ne part."""

    code = "USAGE_SYNC_FAILED"

    def __init__(self, message: str, usage_sync: dict):
        super().__init__(message)
        self.usage_sync = usage_sync


# ── Registre du dernier passage de chaque job ─────────────────────
# Un job qui échoue ne doit pas se contenter d'une ligne de log : du point de
# vue d'APScheduler il se termine « normalement » et le panneau admin
# n'affiche aucune anomalie. Ce registre est exposé par get_scheduler_status(),
# lui-même remonté dans /internal/pipeline-status. Il vit en mémoire : vide à
# chaque démarrage.
_last_job_runs: dict[str, dict] = {}


def _record_job_run(job_id: str, status: str, detail: str | None = None) -> None:
    """Enregistre l'issue du dernier passage d'un job ('success' ou 'failed')."""
    _last_job_runs[job_id] = {
        "status": status,
        "detail": detail,
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }


# ── Suivi des passes dans la table PipelineJob ──────────────────
#
# Le suivi ne doit jamais faire tomber une exécution : si la base ne répond
# pas, la passe n'est pas lancée (voir _run_rotation_pass).

def _start_rotation_job(school_id: str, phase: str) -> str | None:
    """Ouvre le job d'une passe en base. Retourne son id, ou None si l'écriture échoue."""
    try:
        job_id = pipeline_jobs.create_job(school_id, phase, source=pipeline_jobs.SOURCE_ROTATION)
        pipeline_jobs.mark_running(job_id)
        return job_id
    except Exception as e:
        logger.warning(f"⚠️ [ROTATION] Job non enregistré en base pour {school_id}: {e}")
        return None


def _finish_rotation_job(job_id: str | None, status: str, result=None, error=None) -> None:
    """Clôt le job d'une passe en base, si son ouverture avait réussi."""
    if not job_id:
        return
    try:
        pipeline_jobs.complete_job(job_id, status, result=result, error=error)
    except Exception as e:
        logger.warning(f"⚠️ [ROTATION] Clôture du job {job_id} non enregistrée: {e}")


def _school_is_busy(school_id: str) -> bool:
    """
    Vrai si un job tourne déjà sur cette école (déclenché à la main, ou par la
    passe précédente). Empêche de doubler un traitement en cours et de
    consommer deux fois les crédits Tavily.
    """
    try:
        return pipeline_jobs.get_active_job(school_id) is not None
    except Exception as e:
        # Base injoignable : on ne bloque pas l'exécution sur un contrôle de confort.
        logger.warning(f"⚠️ [ROTATION] Contrôle de concurrence impossible ({e})")
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
                "coalesce": True,    # Fusionner les passages manqués (poste en veille)
                "max_instances": 1,  # Une seule instance à la fois
            }
        )
    return _scheduler


# ── Passes dues ───────────────────────────────────────────────────

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


def _candidate_dict(candidate) -> dict:
    """Une passe due, telle que pipeline-status et le rapport la montrent."""
    return {
        "school_name": candidate.school_name,
        "phase": candidate.phase,
        "reason": candidate.reason,
        "last_pass_at": candidate.last_pass_at.isoformat() if candidate.last_pass_at else None,
        "estimated_credits": candidate.estimated_credits,
    }


def _run_rotation_pass(candidate, key_manager) -> _PassOutcome:
    """
    Une passe due, tracée comme un PipelineJob `source = "rotation"`.

    Le job EST la mémoire du passage (rotation.py) : s'il ne peut pas être
    ouvert, la passe n'est pas lancée — sinon l'école serait repayée au
    lancement suivant. Il porte un battement de cœur : une passe muette plus de
    PIPELINE_JOB_STALE_SECONDS serait déclarée morte en cours de route.
    """
    from backend.pipeline.phase1_research import run_phase1_research
    from backend.pipeline.phase2_research import run_phase2_research
    from backend.scheduler.rotation import PHASE_1

    if _school_is_busy(candidate.school_id):
        logger.info(f"⏭️ [ROTATION] {candidate.school_name} : un job est déjà en cours — passée")
        return _PassOutcome("busy")

    # Libellés inchangés depuis le cron : ce sont eux qui font la mémoire du
    # dernier passage (pipeline_jobs.ROTATION_PASS_LABELS).
    phase_label = (
        pipeline_jobs.PHASE1_CRON_LABEL if candidate.phase == PHASE_1
        else pipeline_jobs.PHASE2_CRON_LABEL
    )
    job_id = _start_rotation_job(candidate.school_id, phase_label)
    if job_id is None:
        return _PassOutcome("not_recorded", "job non enregistré en base : passe non lancée")

    def progress(details: dict) -> None:
        pipeline_jobs.update_progress(job_id, details)

    watch = _QuotaWatch(key_manager)
    logger.info(f"🚀 [ROTATION] {_describe(candidate)} ({candidate.reason})")
    try:
        if candidate.phase == PHASE_1:
            # Jamais de collecte du rattachement campus depuis les passes dues
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
        _finish_rotation_job(job_id, pipeline_jobs.STATUS_FAILED, error=str(e))
        return _PassOutcome(pipeline_jobs.STATUS_FAILED, str(e), quota_exhausted=True)
    except Exception as e:
        logger.error(f"❌ [ROTATION] {_describe(candidate)} : {e}")
        _finish_rotation_job(job_id, pipeline_jobs.STATUS_FAILED, error=str(e))
        return _PassOutcome(pipeline_jobs.STATUS_FAILED, str(e))

    if watch.refused or key_manager.available_keys == 0:
        logger.error(f"🛑 [ROTATION] {_describe(candidate)} : {_QUOTA_CUT_ERROR}")
        _finish_rotation_job(job_id, pipeline_jobs.STATUS_FAILED, result=result, error=_QUOTA_CUT_ERROR)
        return _PassOutcome(pipeline_jobs.STATUS_FAILED, _QUOTA_CUT_ERROR, quota_exhausted=True)

    if result.get("success"):
        logger.info(f"✅ [ROTATION] {_describe(candidate)} : {result.get('message')}")
        _finish_rotation_job(job_id, pipeline_jobs.STATUS_COMPLETED, result=result)
        return _PassOutcome(pipeline_jobs.STATUS_COMPLETED)

    # Le résultat est gardé : une Phase 2 en échec y nomme ses cibles
    # (`failed_targets`), comme le font déjà les déclencheurs manuels.
    message = result.get("message") or "Échec inconnu"
    logger.warning(f"⚠️ [ROTATION] {_describe(candidate)} : {message}")
    _finish_rotation_job(job_id, pipeline_jobs.STATUS_FAILED, result=result, error=message)
    return _PassOutcome(pipeline_jobs.STATUS_FAILED, message)


def _select_passes(candidates, used: int, max_passes: int) -> list:
    """
    Ce qui partirait : dans l'ordre, au plus `max_passes` candidats qui tiennent
    sous le plafond, chaque passe retenue comptée à son estimation. C'est une
    prévision : l'exécution relit les crédits réels après chaque passe, et
    saute une école devenue occupée entre-temps.
    """
    selected = []
    for candidate in candidates:
        if len(selected) >= max_passes:
            break
        if used + candidate.estimated_credits > MONTHLY_CREDIT_CEILING:
            continue
        selected.append(candidate)
        used += candidate.estimated_credits
    return selected


def _new_report(key_manager, max_passes: int, dry_run: bool, usage_sync: dict | None) -> dict:
    return {
        "dry_run": dry_run,
        "max_passes": max_passes,
        "status": "failed",
        "detail": None,
        "monthly_ceiling": MONTHLY_CREDIT_CEILING,
        "month_credits_used": None,
        "due_count": 0,
        "planned": [],
        "launched": [],
        "usage_sync": usage_sync if usage_sync is not None else (
            key_manager.last_sync if key_manager is not None else None
        ),
    }


def _plan_due_passes(key_manager, max_passes: int, dry_run: bool, now, usage_sync=None):
    """
    Lit l'état, planifie, et rend `(rapport, candidats)`. Le rapport vaut
    `planned` si des passes doivent partir ; sinon il est final (`success` :
    rien de dû, plafond atteint ; `failed` : planification impossible).
    """
    from backend.db import get_db_connection
    from backend.scheduler.rotation import load_rotation_state, plan_rotation

    report = _new_report(key_manager, max_passes, dry_run, usage_sync)
    try:
        # Un job mort encore marqué actif ferait sauter son école.
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
        report["detail"] = f"planification : {e}"
        return report, []

    report["month_credits_used"] = used
    report["due_count"] = len(candidates)
    logger.info(
        f"📋 [ROTATION] {len(candidates)} passe(s) due(s) ; crédits du mois "
        f"{used}/{MONTHLY_CREDIT_CEILING} ; en tête : "
        + (", ".join(f"{_describe(c)} ({c.reason})" for c in candidates[:5]) or "—")
    )
    if not candidates:
        report.update(status="success", detail="aucune passe due")
        return report, candidates

    if not any(used + c.estimated_credits <= MONTHLY_CREDIT_CEILING for c in candidates):
        detail = (
            f"plafond mensuel atteint : {used}/{MONTHLY_CREDIT_CEILING} crédits, "
            f"{len(candidates)} passe(s) en attente, la moins chère "
            f"~{min(c.estimated_credits for c in candidates)} crédits"
        )
        logger.info(f"⏸️ [ROTATION] {detail}")
        report.update(status="success", detail=detail)
        return report, candidates

    planned = _select_passes(candidates, used, max_passes)
    report["planned"] = [_candidate_dict(c) for c in planned]
    report.update(
        status=REPORT_PLANNED,
        detail=f"{len(planned)} passe(s) au départ : " + " ; ".join(_describe(c) for c in planned),
    )
    return report, candidates


def _launch(report: dict, candidates, key_manager, max_passes: int) -> None:
    """
    Lance les passes, dans l'ordre du plan, et complète le rapport. Même règle
    que l'ancien cron : un candidat qui ne tient pas sous le plafond est sauté,
    une école occupée aussi ; un quota épuisé ou un job non créé arrête tout ;
    les crédits sont relus au gestionnaire de clés après chaque passe.
    """
    used = report["month_credits_used"]
    launched: list[tuple] = []
    for candidate in candidates:
        if len(launched) >= max_passes:
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

    report["launched"] = [
        {**_candidate_dict(c), "status": o.status, "error": o.error} for c, o in launched
    ]
    if not launched:
        report.update(status="success", detail="aucune passe lancée : écoles occupées")
        return

    failed = [o for _, o in launched if o.status != pipeline_jobs.STATUS_COMPLETED]
    report.update(
        status="failed" if failed else "success",
        detail=" ; ".join(
            _describe(c) + (f" — {o.error}" if o.error else "") for c, o in launched
        ),
    )


def _close(record_id: str, report: dict) -> dict:
    """Inscrit l'issue au registre, puis rend le rapport."""
    _record_job_run(record_id, "failed" if report["status"] == "failed" else "success", report["detail"])
    return report


# Une exécution réelle à la fois, dans ce processus. Ne vaut que par
# processus : deux backends feraient deux verrous (backend-local.md §7).
_run_lock = threading.Lock()


def run_due_passes(key_manager, max_passes: int = 1, dry_run: bool = False,
                   now: datetime | None = None, on_planned=None) -> dict:
    """
    Les passes dues, sous plafond : au plus `max_passes` (1 à
    MAX_PASSES_PER_RUN) passes Phase 1 ou Phase 2, choisies par
    `rotation.plan_rotation`. Rend le rapport, et l'inscrit au registre.

    - `dry_run=True` : lit l'état, planifie et rend le plan (`planned`), sans
      synchro /usage, sans créer de job ni appeler Research. Pas de verrou :
      elle n'écrit aucun job et ne paie rien. Elle remplace l'ancienne astuce
      du plafond à 0.
    - Réel : verrou de module (RotationAlreadyRunning si une exécution tourne
      déjà), puis synchro /usage bloquante. Si une clé n'a pas pu être
      recalée, UsageSyncFailed et rien ne part : les compteurs repartent de
      zéro à chaque démarrage (F8). Ensuite, planification, puis
      `on_planned(rapport)` avec ce qui va partir (statut `planned`), avant la
      première passe. La route HTTP s'en sert pour répondre 202 sans attendre
      la fin des passes.

    Rapport : `{dry_run, max_passes, status, detail, monthly_ceiling,
    month_credits_used, due_count, planned, launched, usage_sync}`. `status`
    vaut `success` ou `failed` une fois l'exécution finie.
    """
    if not 1 <= max_passes <= MAX_PASSES_PER_RUN:
        raise ValueError(f"max_passes doit être compris entre 1 et {MAX_PASSES_PER_RUN}")

    record_id = DRY_RUN_JOB_ID if dry_run else ROTATION_JOB_ID
    if key_manager is None:
        logger.error("❌ [ROTATION] Aucun TavilyKeyManager : aucune passe ne part")
        report = _new_report(None, max_passes, dry_run, None)
        report["detail"] = "TavilyKeyManager absent : aucune clé chargée"
        return _close(record_id, report)

    if dry_run:
        logger.info("🧪 [ROTATION] Simulation des passes dues")
        report, _ = _plan_due_passes(key_manager, max_passes, dry_run=True, now=now)
        if report["status"] == REPORT_PLANNED:
            report["status"] = "success"
        report["detail"] = f"simulation : {report['detail']}"
        return _close(record_id, report)

    if not _run_lock.acquire(blocking=False):
        raise RotationAlreadyRunning("Une exécution des passes dues tourne déjà")
    try:
        logger.info(f"⏰ [ROTATION] Passes dues demandées (au plus {max_passes})")
        usage_sync = key_manager.sync_usage()
        if not usage_sync.get("ok"):
            failed_keys = ", ".join(usage_sync.get("failed_keys") or []) or "clé inconnue"
            detail = f"synchro /usage en échec ({failed_keys}) : aucune passe lancée"
            logger.error(f"❌ [ROTATION] {detail}")
            _record_job_run(record_id, "failed", detail)
            raise UsageSyncFailed(detail, usage_sync)

        report, candidates = _plan_due_passes(
            key_manager, max_passes, dry_run=False, now=now, usage_sync=usage_sync,
        )
        if on_planned is not None:
            on_planned(copy.deepcopy(report))
        if report["status"] == REPORT_PLANNED:
            _launch(report, candidates, key_manager, max_passes)
        return _close(record_id, report)
    finally:
        _run_lock.release()


# ── Traitement des contributions ──────────────────────────────────

def _describe_crowdsourcing(outcome: dict | None) -> tuple[str, str]:
    """Le bilan d'un passage du crowdsourcing, en (statut, détail) pour le registre."""
    if not outcome or not outcome.get("tickets"):
        return "success", "aucune contribution en attente"
    detail = (
        f"{outcome['tickets']} contribution(s) : {outcome.get('validated', 0)} en attente "
        f"de l'admin, {outcome.get('api_errors', 0)} en erreur d'API (gardée(s) en attente), "
        f"{outcome.get('rejected', 0)} en échec"
    )
    if outcome.get("quota_exhausted"):
        # Les contributions restantes attendent en Pending_AI : l'admin doit le voir.
        return "failed", f"quota Tavily épuisé : traitement interrompu ; {detail}"
    return "success", detail


def _crowdsourcing_job(key_manager) -> None:
    """
    Un passage du traitement des contributions, inscrit au registre (F4).

    Ne lève jamais : APScheduler ne ferait que journaliser l'exception, et
    pipeline-status n'en saurait rien. L'échec se lit dans `last_runs`.
    """
    from backend.crowdsourcing.processor import process_pending_submissions

    try:
        outcome = process_pending_submissions(key_manager)
    except Exception as e:
        logger.error(f"❌ [Crowdsourcing] Passage en échec : {e}")
        _record_job_run(CROWDSOURCING_JOB_ID, "failed", str(e)[:300])
        return
    _record_job_run(CROWDSOURCING_JOB_ID, *_describe_crowdsourcing(outcome))


def _crowdsourcing_interval_minutes() -> int:
    """Une valeur illisible retombe sur le défaut, au lieu d'empêcher le démarrage (F9)."""
    return env_int(
        "CRON_CROWDSOURCING_INTERVAL_MINUTES",
        CROWDSOURCING_DEFAULT_INTERVAL_MINUTES,
        minimum=1,
    )


# ── Démarrage / Arrêt ─────────────────────────────────────────────

def start_scheduler(key_manager):
    """
    Démarre le scheduler, qui ne porte que le traitement des contributions.
    Appelé depuis le lifespan FastAPI (main.py).

    Aucune recherche n'y est inscrite : les passes dues partent sur demande
    (run_due_passes). Le premier passage du crowdsourcing part tout de suite :
    les contributions attendent en Pending_AI entre deux lancements du backend.
    """
    scheduler = get_scheduler()

    if scheduler.running:
        logger.warning("⚠️ Scheduler déjà en cours — skip")
        return

    interval = _crowdsourcing_interval_minutes()
    scheduler.add_job(
        func=_crowdsourcing_job,
        trigger=IntervalTrigger(minutes=interval),
        args=[key_manager],
        id=CROWDSOURCING_JOB_ID,
        name=f"Traitement des contributions (toutes les {interval} min)",
        next_run_time=datetime.now(timezone.utc),
        replace_existing=True,
    )

    scheduler.start()
    logger.info(
        f"✅ Scheduler démarré : contributions toutes les {interval} min, première "
        "passe maintenant. Aucune recherche planifiée : les passes dues partent sur "
        "demande (POST /internal/run-due-passes)."
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


ROTATION_STATUS_NEXT_COUNT = 5


def _rotation_status(key_manager) -> dict:
    """
    Le bloc `rotation` de pipeline-status : les passes dues, ce qu'elles ont
    coûté, et si les crédits du mois sont recalés sur Tavily.

    `next` : les premières passes que run_due_passes choisirait maintenant.
    Lecture en base courte ; une erreur se rend dans le bloc (`{"error": …}`)
    sans faire échouer pipeline-status. `last_run` vient du registre en
    mémoire : vide après un redémarrage. `usage_sync` : la dernière synchro
    /usage de toutes les clés (`{ok, at, failed_keys}`), ou null.
    """
    from backend.db import get_db_connection
    from backend.scheduler.rotation import INTERVAL_DAYS, load_rotation_state, plan_rotation

    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                state = load_rotation_state(cur)
        candidates = plan_rotation(
            state.schools, state.last_passes, state.discovery_pending,
            datetime.now(timezone.utc),
        )
        used = key_manager.credits_used_this_month() if key_manager is not None else None
    except Exception as e:
        logger.warning(f"⚠️ État de la rotation illisible : {e}")
        return {"error": str(e)[:300]}

    return {
        "interval_days": INTERVAL_DAYS,
        "monthly_ceiling": MONTHLY_CREDIT_CEILING,
        "month_credits_used": used,
        "due_count": len(candidates),
        "next": [_candidate_dict(c) for c in candidates[:ROTATION_STATUS_NEXT_COUNT]],
        "last_run": _last_job_runs.get(ROTATION_JOB_ID),
        "usage_sync": key_manager.last_sync if key_manager is not None else None,
    }


def get_scheduler_status(key_manager=None) -> dict:
    """
    Retourne le statut du scheduler (pour pipeline-status). `key_manager` sert
    aux crédits du mois et à la synchro /usage du bloc `rotation`.
    """
    scheduler = _scheduler
    running = bool(scheduler and scheduler.running)

    jobs = []
    if running:
        for job in scheduler.get_jobs():
            next_run = job.next_run_time
            jobs.append({
                "id": job.id,
                "name": job.name,
                "next_run": next_run.isoformat() if next_run else None,
                "last_run": _last_job_runs.get(job.id),
            })

    return {
        "running": running,
        "jobs": jobs,
        "last_runs": dict(_last_job_runs),
        # Vrai dès qu'un job a échoué à son dernier passage : c'est ce drapeau
        # que le panneau admin doit surveiller.
        "has_failure": any(
            run.get("status") == "failed" for run in _last_job_runs.values()
        ),
        "rotation": _rotation_status(key_manager),
    }
