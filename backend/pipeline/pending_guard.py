"""
backend/pipeline/pending_guard.py — Ce qui attend déjà l'admin

`has_data_changed` ne compare qu'à la production, et `_insert_ticket` n'interroge
pas l'Inbox : un ticket que l'admin n'a pas encore validé était repayé et recréé
à chaque passe automatique. Ce module lit, pour une école, les cibles dont un
ticket du pipeline est encore `Pending_Admin` ; la passe automatique les saute.

Cibles, catégorie par catégorie :
  - SchoolStats, Accreditation, Ranking : l'école — un seul ticket Ranking en
    attente suffit à sauter la recherche, qui couvre tous les programmes ;
  - Pricing : un programme ;
  - Capacity : un couple programme × campus ;
  - Program_Discovery portant `discovered_campuses` : l'école (Phase 1).

Seuls les tickets créés depuis le début de la période cible comptent : un ticket
plus ancien visait l'année cible précédente. La découverte fait exception, elle
n'est liée à aucune année. Les tickets de crowdsourcing ne comptent pas, ni les
tickets `Program_Discovery` de rattachement campus ou de rapport rangé.

Référence : docs/features/cron-rotation-production.md, étape 1.
"""

from dataclasses import dataclass, field
from datetime import date, datetime

from backend.constants import (
    CATEGORY_ACCREDITATION,
    CATEGORY_CAPACITY,
    CATEGORY_PRICING,
    CATEGORY_PROGRAM_DISCOVERY,
    CATEGORY_RANKING,
    CATEGORY_SCHOOL_STATS,
    SOURCE_AUTOMATED_AI,
    STATUS_PENDING_ADMIN,
)

# Catégories dont la recherche vise l'école entière.
SCHOOL_TARGET_CATEGORIES = frozenset(
    {CATEGORY_SCHOOL_STATS, CATEGORY_ACCREDITATION, CATEGORY_RANKING}
)


@dataclass
class PendingTargets:
    """Cibles d'une école dont un ticket du pipeline attend la validation."""

    school_categories: set[str] = field(default_factory=set)
    pricing_program_ids: set[str] = field(default_factory=set)
    capacity_program_campus_ids: set[str] = field(default_factory=set)
    discovery_pending: bool = False


def _created_on(value: datetime | date) -> date:
    return value.date() if isinstance(value, datetime) else value


def read_pending_targets(cur, school_id: str, period_start: date) -> PendingTargets:
    """
    Une requête sur ContributionInbox, dans la connexion de l'appelant.

    `cur` doit être un RealDictCursor. La période ne s'applique qu'aux catégories
    de Phase 2 ; elle est tranchée ici plutôt qu'en SQL pour que la découverte,
    qui n'a pas d'année, soit lue dans la même requête.
    """
    cur.execute(
        """
        SELECT ai_category, "programId", "programCampusId", "createdAt",
               COALESCE(ai_extracted_json ? 'discovered_campuses', false) AS is_discovery
        FROM "ContributionInbox"
        WHERE "schoolId" = %s
          AND status = %s
          AND source_type = %s
        """,
        (school_id, STATUS_PENDING_ADMIN, SOURCE_AUTOMATED_AI),
    )

    targets = PendingTargets()
    for row in cur.fetchall():
        category = row["ai_category"]
        if category == CATEGORY_PROGRAM_DISCOVERY:
            if row["is_discovery"]:
                targets.discovery_pending = True
            continue

        if _created_on(row["createdAt"]) < period_start:
            continue

        if category in SCHOOL_TARGET_CATEGORIES:
            targets.school_categories.add(category)
        elif category == CATEGORY_PRICING and row["programId"]:
            targets.pricing_program_ids.add(row["programId"])
        elif category == CATEGORY_CAPACITY and row["programCampusId"]:
            targets.capacity_program_campus_ids.add(row["programCampusId"])

    return targets
