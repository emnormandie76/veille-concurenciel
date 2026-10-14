"""
backend/scheduler/rotation.py — Quelles passes la rotation doit lancer, dans quel ordre

Le propriétaire a retenu deux passes par an et par école, Phase 1 comme Phase 2,
sur ~30 écoles et ~10 000 crédits Tavily par mois. Ce module dit, pour un instant
donné, quelles passes sont dues et dans quel ordre les lancer. Il ne lance rien :
c'est `run_due_passes` (backend/scheduler/jobs.py), à la demande de l'admin, qui
choisit sous le plafond mensuel les premiers candidats qui tiennent.

## La mémoire du dernier passage

Pas de nouvelle table : c'est `PipelineJob`. Les jobs portant un libellé de
passage complet (`pipeline_jobs.ROTATION_LABELS`) sont gardés
PIPELINE_JOB_ROTATION_RETENTION_DAYS jours au lieu de 7. L'enrichissement ciblé
(un programme, des catégories choisies) ne compte pas.

## Une passe est due quand…

| Dernier passage terminé | Due ? |
|---|---|
| aucun | oui — `never` |
| `completed` il y a plus de CRON_RESEARCH_INTERVAL_DAYS (182) | oui — `interval` |
| `failed` il y a plus de CRON_RESEARCH_RETRY_FAILED_DAYS (14) | oui — `retry_after_failure` |
| sinon, ou job actif sur l'école | non |

Le délai court après un échec évite de repayer à chaque lancement une découverte qui
échoue, sans attendre six mois après une simple coupure. En plus : Phase 1 pas
due si une découverte attend l'admin ; Phase 2 pas due sans aucun `Program` ;
seules les écoles ACTIVE sont candidates.

## Ordre

1. Phase 1 des écoles sans aucun `Program` — tout le reste en dépend ;
2. Phase 2 jamais passée — la découverte vient d'être validée ;
3. les autres, du passage le plus ancien au plus récent ;
4. à égalité, nom d'école croissant : l'ordre est déterministe, donc testable.

## Coût estimé

Tiré de `ESTIMATED_CREDITS` et des catégories de la Phase 2, sans rien
soustraire — ni les cibles en attente que la passe sautera, ni les rapports
rangés : l'estimation est prudente. Phase 1 : catalogue ~5 + Research pro 25.

Référence : docs/features/cron-rotation-production.md, étape 3 ; le cron a été
remplacé par les passes dues sur demande (docs/features/backend-local.md, étape 3).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from backend import pipeline_jobs
from backend.pipeline.pending_guard import read_discovery_pending
from backend.pipeline.phase2_research import (
    PROGRAM_CAMPUS_LEVEL_CATEGORIES,
    PROGRAM_LEVEL_CATEGORIES,
    SCHOOL_LEVEL_CATEGORIES,
    _get_research_model,
)
from backend.pipeline_jobs import LastPass
from backend.tavily_service.catalog_client import CATALOG_REQUIRED_CREDITS
from backend.tavily_service.research_client import ESTIMATED_CREDITS
from backend.utils.env import env_int

PHASE_1 = "1"
PHASE_2 = "2"

REASON_NEVER = "never"
REASON_INTERVAL = "interval"
REASON_RETRY_AFTER_FAILURE = "retry_after_failure"

SCHOOL_STATUS_ACTIVE = "ACTIVE"

INTERVAL_DAYS = env_int("CRON_RESEARCH_INTERVAL_DAYS", 182, minimum=1)
RETRY_FAILED_DAYS = env_int("CRON_RESEARCH_RETRY_FAILED_DAYS", 14, minimum=1)

PHASE1_ESTIMATED_CREDITS = CATALOG_REQUIRED_CREDITS + ESTIMATED_CREDITS["pro"]

# Plus ancien que tout passage réel : une passe jamais faite passe en tête de
# son groupe.
_NEVER = datetime.min.replace(tzinfo=timezone.utc)


@dataclass(frozen=True)
class RotationConfig:
    interval_days: int = INTERVAL_DAYS
    retry_failed_days: int = RETRY_FAILED_DAYS


@dataclass(frozen=True)
class SchoolState:
    id: str
    name: str
    status: str
    program_count: int
    program_campus_count: int
    has_active_job: bool = False


@dataclass(frozen=True)
class Candidate:
    school_id: str
    school_name: str
    phase: str                      # PHASE_1 | PHASE_2
    reason: str                     # REASON_*
    last_pass_at: datetime | None
    estimated_credits: int


@dataclass
class RotationState:
    schools: list[SchoolState] = field(default_factory=list)
    last_passes: dict[tuple[str, str], LastPass] = field(default_factory=dict)
    discovery_pending: set[str] = field(default_factory=set)


# ── Coût ──────────────────────────────────────────────────────────

def _credits_per_call(categories: list[str]) -> int:
    return sum(ESTIMATED_CREDITS[_get_research_model(category)] for category in categories)


def estimate_phase2_credits(program_count: int, program_campus_count: int) -> int:
    """SchoolStats + Accreditation + Ranking, Pricing par programme, Capacity par couple."""
    return (
        _credits_per_call(SCHOOL_LEVEL_CATEGORIES)
        + program_count * _credits_per_call(PROGRAM_LEVEL_CATEGORIES)
        + program_campus_count * _credits_per_call(PROGRAM_CAMPUS_LEVEL_CATEGORIES)
    )


def _estimated_credits(school: SchoolState, phase: str) -> int:
    if phase == PHASE_1:
        return PHASE1_ESTIMATED_CREDITS
    return estimate_phase2_credits(school.program_count, school.program_campus_count)


# ── Planification (pure) ──────────────────────────────────────────

def _due_reason(last: LastPass | None, now: datetime, config: RotationConfig) -> str | None:
    if last is None:
        return REASON_NEVER
    age = now - last.finished_at
    if last.status == pipeline_jobs.STATUS_COMPLETED and age > timedelta(days=config.interval_days):
        return REASON_INTERVAL
    if last.status == pipeline_jobs.STATUS_FAILED and age > timedelta(days=config.retry_failed_days):
        return REASON_RETRY_AFTER_FAILURE
    return None


def _priority(school: SchoolState, phase: str, reason: str, last: LastPass | None) -> tuple:
    if phase == PHASE_1 and school.program_count == 0:
        group = 0
    elif phase == PHASE_2 and reason == REASON_NEVER:
        group = 1
    else:
        group = 2
    return (
        group,
        last.finished_at if last else _NEVER,
        school.name.casefold(),
        school.name,
        phase,
    )


def plan_rotation(
    schools: list[SchoolState],
    last_passes: dict[tuple[str, str], LastPass],
    discovery_pending: set[str],
    now: datetime,
    config: RotationConfig | None = None,
) -> list[Candidate]:
    """
    Les passes dues à `now` (UTC, avec fuseau), dans l'ordre où les lancer.

    Aucun accès réseau ni base : `load_rotation_state` fournit les entrées.
    """
    config = config or RotationConfig()
    ranked: list[tuple[tuple, Candidate]] = []

    for school in schools:
        if school.status != SCHOOL_STATUS_ACTIVE or school.has_active_job:
            continue
        for phase in (PHASE_1, PHASE_2):
            if phase == PHASE_1 and school.id in discovery_pending:
                continue
            if phase == PHASE_2 and school.program_count == 0:
                continue
            last = last_passes.get((school.id, phase))
            reason = _due_reason(last, now, config)
            if reason is None:
                continue
            ranked.append((
                _priority(school, phase, reason, last),
                Candidate(
                    school_id=school.id,
                    school_name=school.name,
                    phase=phase,
                    reason=reason,
                    last_pass_at=last.finished_at if last else None,
                    estimated_credits=_estimated_credits(school, phase),
                ),
            ))

    ranked.sort(key=lambda item: item[0])
    return [candidate for _, candidate in ranked]


# ── Lecture en base ───────────────────────────────────────────────

def load_rotation_state(cur) -> RotationState:
    """
    Ce que `plan_rotation` doit savoir, en trois requêtes dans la connexion de
    l'appelant (`cur` : RealDictCursor) : les écoles ACTIVE avec leurs comptes
    de `Program` et de `ProgramCampus` et leur job actif éventuel, leurs
    derniers passages, et leurs découvertes en attente.
    """
    cur.execute(
        """
        SELECT s.id, s.name, s.status,
               (SELECT count(*) FROM "Program" p WHERE p."schoolId" = s.id) AS program_count,
               (SELECT count(*)
                  FROM "ProgramCampus" pc
                  JOIN "Program" p ON p.id = pc."programId"
                 WHERE p."schoolId" = s.id) AS program_campus_count,
               EXISTS (SELECT 1 FROM "PipelineJob" j
                        WHERE j."schoolId" = s.id AND j.status = ANY(%s)) AS has_active_job
        FROM "School" s
        WHERE s.status = %s
        ORDER BY s.name
        """,
        (list(pipeline_jobs.ACTIVE_STATUSES), SCHOOL_STATUS_ACTIVE),
    )
    schools = [
        SchoolState(
            id=row["id"],
            name=row["name"],
            status=row["status"],
            program_count=int(row["program_count"]),
            program_campus_count=int(row["program_campus_count"]),
            has_active_job=bool(row["has_active_job"]),
        )
        for row in cur.fetchall()
    ]
    school_ids = [school.id for school in schools]
    return RotationState(
        schools=schools,
        last_passes=pipeline_jobs.read_last_passes(cur, school_ids),
        discovery_pending=read_discovery_pending(cur, school_ids),
    )
