"""
backend/pipeline_jobs.py — État des jobs du pipeline, en base

Remplace `_pipeline_jobs` et `_pipeline_progress`, deux dictionnaires de module
de `backend/routers/internal.py`. Ils portaient le seul état d'avancement du
pipeline, dans un processus unique, sur un hébergeur qui redémarre :

  - au redémarrage, un job « running » disparaissait sans jamais passer à
    « failed ». Comme les points d'entrée refusent de lancer un scan quand un
    job tourne déjà sur l'école, l'école restait verrouillée sans que rien ne
    l'indique — un verrouillage fantôme ;
  - `_pipeline_jobs` n'était jamais purgé : chaque recherche ciblée y créait une
    clé qui ne repartait plus ;
  - l'état n'était consultable que depuis le processus qui le portait.

Deux mécanismes remplacent la disparition silencieuse :

  1. `updated_at` sert de battement de cœur. Chaque avancement de progression le
     rafraîchit. Un job actif dont l'horodatage a dépassé
     PIPELINE_JOB_STALE_SECONDS est réputé mort et repasse en « failed ».
  2. Au démarrage du processus, `reap_orphaned_jobs()` clôt immédiatement les
     jobs actifs laissés par un autre worker (ou par une exécution précédente).
     Cela suppose UN SEUL processus backend à la fois — c'est le déploiement
     Koyeb EcoFree actuel. Passer à plusieurs instances imposerait de retirer
     cet appel et de s'en remettre au seul battement de cœur.

Aucune écriture Prisma ici : le backend Python parle à PostgreSQL en psycopg2.
Le schéma, lui, est déclaré côté Prisma (modèle `PipelineJob`) et créé par la
migration 20260902100000_pipeline_job_state.
"""

import os
import json
import uuid
import socket
import logging
from dataclasses import dataclass
from datetime import datetime, timezone

import psycopg2.extras

from backend.utils.env import env_int

logger = logging.getLogger("pipeline.jobs_store")

# ── Identité du processus ─────────────────────────────────────────
# Un job dont le worker_id ne correspond pas au processus courant a été laissé
# par une exécution précédente : personne ne le fera plus avancer.
WORKER_ID = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"

# ── Statuts ───────────────────────────────────────────────────────
STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"

ACTIVE_STATUSES = (STATUS_QUEUED, STATUS_RUNNING)

# Au-delà de ce silence, un job actif est réputé mort. Doit rester nettement
# supérieur à la durée d'un pas de pipeline : un Tavily Research « pro » peut
# attendre jusqu'à 600 s sans émettre de progression.
STALE_AFTER_SECONDS = int(os.environ.get("PIPELINE_JOB_STALE_SECONDS", 1800))

# Rétention des jobs terminés. Au-delà, la ligne est supprimée : c'est la purge
# que `_pipeline_jobs` n'avait jamais.
RETENTION_DAYS = int(os.environ.get("PIPELINE_JOB_RETENTION_DAYS", 7))

# ── Libellés de phase ─────────────────────────────────────────────
# Écrits dans PipelineJob.phase par les points d'entrée, relus par la rotation
# des recherches (backend/scheduler/rotation.py) pour dater le dernier passage
# d'une école. Une faute de frappe d'un côté effacerait cette mémoire en
# silence : aucun littéral ailleurs.
PHASE1_LABEL = "Phase 1 — Cartographie"
PHASE1_CRON_LABEL = "Phase 1 — Cartographie (Auto)"
PHASE2_LABEL = "Phase 2 — Enrichissement"
PHASE2_CRON_LABEL = "Phase 2 — Enrichissement (Auto)"
PHASE2_TARGETED_LABEL = "Phase 2 — Enrichissement ciblé"

# Libellés qui comptent comme un passage COMPLET, par phase. L'enrichissement
# ciblé (un programme, des catégories choisies) n'en est pas un.
ROTATION_PASS_LABELS: dict[str, tuple[str, ...]] = {
    "1": (PHASE1_LABEL, PHASE1_CRON_LABEL),
    "2": (PHASE2_LABEL, PHASE2_CRON_LABEL),
}
_PASS_PHASE_BY_LABEL = {
    label: phase for phase, labels in ROTATION_PASS_LABELS.items() for label in labels
}
ROTATION_LABELS: tuple[str, ...] = tuple(_PASS_PHASE_BY_LABEL)

# Les jobs de rotation sont la seule mémoire du dernier passage d'une école :
# purgés à 7 jours, l'école paraîtrait jamais passée et serait repayée. Doit
# rester supérieur à CRON_RESEARCH_INTERVAL_DAYS (182 par défaut).
ROTATION_RETENTION_DAYS = env_int("PIPELINE_JOB_ROTATION_RETENTION_DAYS", 400, minimum=1)

_STALE_ERROR = (
    "Job interrompu : aucun signe de vie depuis plus de "
    f"{STALE_AFTER_SECONDS}s (processus redémarré ou tâche perdue)."
)
_ORPHAN_ERROR = (
    "Job interrompu : le processus qui le portait s'est arrêté "
    "(redémarrage de l'instance)."
)

# Colonnes exposées à l'API de supervision.
_JOB_COLUMNS = (
    'id, "schoolId", phase, source, status, progress, result, error, '
    "started_at, updated_at, finished_at"
)


def _row_to_job(row) -> dict:
    """Convertit une ligne PipelineJob en dict d'API (forme historique)."""
    if row is None:
        return None
    return {
        # Le panneau admin et les réponses des endpoints parlent de `job_id`
        # depuis toujours : on conserve le nom, la valeur est l'id de la ligne.
        "job_id": row["id"],
        "school_id": row["schoolId"],
        "phase": row["phase"],
        "source": row["source"],
        "status": row["status"],
        "progress_details": row.get("progress"),
        "result": row.get("result"),
        "error": row.get("error"),
        "created_at": row["started_at"].isoformat() if row.get("started_at") else None,
        "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
        "finished_at": row["finished_at"].isoformat() if row.get("finished_at") else None,
    }


# ── Écritures ─────────────────────────────────────────────────────

def create_job(
    school_id: str,
    phase: str,
    source: str = "manual",
    progress: dict | None = None,
) -> str:
    """Insère un job en statut « queued » et retourne son identifiant."""
    from backend.db import get_db_connection

    job_id = str(uuid.uuid4())
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO "PipelineJob"
                    (id, "schoolId", phase, source, status, worker_id, progress,
                     started_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, now(), now())
                """,
                (
                    job_id,
                    school_id,
                    phase,
                    source,
                    STATUS_QUEUED,
                    WORKER_ID,
                    json.dumps(progress) if progress else None,
                ),
            )
    return job_id


def mark_running(job_id: str) -> None:
    """Passe un job en « running ». Reprend la propriété du processus courant."""
    from backend.db import get_db_connection

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE "PipelineJob"
                SET status = %s, worker_id = %s, updated_at = now()
                WHERE id = %s
                """,
                (STATUS_RUNNING, WORKER_ID, job_id),
            )


def update_progress(job_id: str, details: dict) -> None:
    """
    Enregistre l'avancement d'un job — et, ce faisant, son battement de cœur.

    Best effort : une progression perdue ne doit pas faire tomber un pipeline en
    cours. Un job dont la progression cesse d'être écrite finira réputé mort,
    ce qui est le comportement recherché.
    """
    from backend.db import get_db_connection

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE "PipelineJob"
                    SET progress = %s::jsonb, updated_at = now()
                    WHERE id = %s
                    """,
                    (json.dumps(details, default=str), job_id),
                )
    except Exception as e:  # noqa: BLE001 — voir la docstring
        logger.warning(f"⚠️ Progression non enregistrée pour le job {job_id}: {e}")


def complete_job(
    job_id: str,
    status: str,
    result: dict | None = None,
    error: str | None = None,
) -> None:
    """Clôt un job en « completed » ou « failed » et horodate sa fin."""
    from backend.db import get_db_connection

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE "PipelineJob"
                SET status = %s,
                    result = %s::jsonb,
                    error = %s,
                    progress = NULL,
                    updated_at = now(),
                    finished_at = now()
                WHERE id = %s
                """,
                (
                    status,
                    json.dumps(result, default=str) if result is not None else None,
                    error[:2000] if error else None,
                    job_id,
                ),
            )


# ── Détection des jobs morts ──────────────────────────────────────

def reap_stale_jobs() -> int:
    """
    Clôt les jobs actifs qui n'ont plus donné signe de vie.

    C'est ce qui rend le verrouillage détectable : sans cet appel, la garde de
    concurrence des points d'entrée bloquerait indéfiniment l'école.
    """
    from backend.db import get_db_connection

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE "PipelineJob"
                SET status = %s, error = %s, updated_at = now(), finished_at = now()
                WHERE status = ANY(%s)
                  AND updated_at < now() - (%s * interval '1 second')
                """,
                (STATUS_FAILED, _STALE_ERROR, list(ACTIVE_STATUSES), STALE_AFTER_SECONDS),
            )
            reaped = cur.rowcount or 0

    if reaped:
        logger.warning(f"🧹 {reaped} job(s) sans signe de vie repassé(s) en 'failed'")
    return reaped


def reap_orphaned_jobs() -> int:
    """
    Clôt les jobs actifs laissés par un autre processus (redémarrage).

    Appelé une fois au démarrage. Suppose un seul worker backend à la fois —
    voir la docstring du module.
    """
    from backend.db import get_db_connection

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE "PipelineJob"
                SET status = %s, error = %s, updated_at = now(), finished_at = now()
                WHERE status = ANY(%s)
                  AND (worker_id IS NULL OR worker_id <> %s)
                """,
                (STATUS_FAILED, _ORPHAN_ERROR, list(ACTIVE_STATUSES), WORKER_ID),
            )
            reaped = cur.rowcount or 0

    if reaped:
        logger.warning(
            f"🧹 {reaped} job(s) orphelin(s) d'un précédent processus clôturé(s)"
        )
    return reaped


def purge_finished_jobs() -> int:
    """
    Supprime les jobs terminés au-delà de la rétention : ROTATION_RETENTION_DAYS
    pour un passage complet (ROTATION_LABELS), RETENTION_DAYS pour les autres.
    """
    from backend.db import get_db_connection

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM "PipelineJob"
                WHERE status <> ALL(%s)
                  AND finished_at IS NOT NULL
                  AND finished_at < now() - (
                      CASE WHEN phase = ANY(%s) THEN %s ELSE %s END * interval '1 day'
                  )
                """,
                (list(ACTIVE_STATUSES), list(ROTATION_LABELS), ROTATION_RETENTION_DAYS, RETENTION_DAYS),
            )
            purged = cur.rowcount or 0

    if purged:
        logger.info(
            f"🧹 {purged} job(s) terminé(s) purgé(s) "
            f"(> {RETENTION_DAYS} j, {ROTATION_RETENTION_DAYS} j pour un passage complet)"
        )
    return purged


# ── Lectures ──────────────────────────────────────────────────────

@dataclass(frozen=True)
class LastPass:
    """Dernier passage complet terminé d'une école pour une phase."""

    status: str             # STATUS_COMPLETED | STATUS_FAILED
    finished_at: datetime   # UTC, avec fuseau


def _as_utc(value: datetime) -> datetime:
    """
    `finished_at` est un TIMESTAMP sans fuseau écrit par now() : de l'UTC sur
    Neon. Rendu avec son fuseau pour se comparer à un instant UTC.
    """
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def read_last_passes(cur, school_ids: list[str]) -> dict[tuple[str, str], LastPass]:
    """
    Dernier job terminé (`completed` ou `failed`) portant un libellé de passage
    complet, par `(école, phase)` — la phase valant "1" ou "2".

    Une requête, dans la connexion de l'appelant ; `cur` doit être un
    RealDictCursor. Une école sans passage n'a pas de clé.
    """
    if not school_ids:
        return {}
    cur.execute(
        """
        SELECT "schoolId", phase, status, finished_at
        FROM "PipelineJob"
        WHERE "schoolId" = ANY(%s)
          AND phase = ANY(%s)
          AND status = ANY(%s)
          AND finished_at IS NOT NULL
        """,
        (list(school_ids), list(ROTATION_LABELS), [STATUS_COMPLETED, STATUS_FAILED]),
    )
    passes: dict[tuple[str, str], LastPass] = {}
    for row in cur.fetchall():
        key = (row["schoolId"], _PASS_PHASE_BY_LABEL[row["phase"]])
        finished_at = _as_utc(row["finished_at"])
        current = passes.get(key)
        if current is None or finished_at > current.finished_at:
            passes[key] = LastPass(row["status"], finished_at)
    return passes


def get_active_job(school_id: str) -> dict | None:
    """
    Retourne le job actif d'une école, ou None.

    Clôt d'abord les jobs morts : c'est ce qui garantit que la garde de
    concurrence ne verrouille pas une école indéfiniment.
    """
    from backend.db import get_db_connection

    reap_stale_jobs()

    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT {_JOB_COLUMNS}
                FROM "PipelineJob"
                WHERE "schoolId" = %s AND status = ANY(%s)
                ORDER BY started_at ASC
                LIMIT 1
                """,
                (school_id, list(ACTIVE_STATUSES)),
            )
            return _row_to_job(cur.fetchone())


def list_active_jobs(limit: int = 20) -> list[dict]:
    """Liste les jobs actifs, les morts ayant d'abord été clôturés."""
    from backend.db import get_db_connection

    reap_stale_jobs()

    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT {_JOB_COLUMNS}
                FROM "PipelineJob"
                WHERE status = ANY(%s)
                ORDER BY started_at ASC
                LIMIT %s
                """,
                (list(ACTIVE_STATUSES), limit),
            )
            return [_row_to_job(row) for row in cur.fetchall()]
