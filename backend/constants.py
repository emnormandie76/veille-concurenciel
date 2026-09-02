"""
backend/constants.py — Énumérations de la zone tampon ContributionInbox

Pendant Python de `lib/contribution.ts`. Les statuts, catégories et types de
source circulaient en chaînes libres, dupliqués des deux côtés de la frontière
sans liste de référence : une faute de frappe créait un état inatteignable, en
silence.

Les deux listes sont tenues ensemble par des contraintes CHECK en base
(migration 20260902120000_contribution_enum_guards) — la seule frontière que les
deux langages partagent réellement. Toute valeur ajoutée ici doit l'être aussi
dans `lib/contribution.ts` ET dans une nouvelle migration qui étend la
contrainte : c'est le prix d'un pipeline à deux langages, et c'est explicite.
"""

# ── Statuts d'un ticket ───────────────────────────────────────────
STATUS_PENDING_AI = "Pending_AI"
STATUS_PENDING_ADMIN = "Pending_Admin"
STATUS_VALIDATED = "Validated"
STATUS_REJECTED = "Rejected"
STATUS_FAILED = "Failed"

CONTRIBUTION_STATUSES = (
    STATUS_PENDING_AI,
    STATUS_PENDING_ADMIN,
    STATUS_VALIDATED,
    STATUS_REJECTED,
    STATUS_FAILED,
)

# ── Catégories d'extraction ───────────────────────────────────────
CATEGORY_PROGRAM_DISCOVERY = "Program_Discovery"
CATEGORY_PRICING = "Pricing"
CATEGORY_RANKING = "Ranking"
CATEGORY_CAPACITY = "Capacity"
CATEGORY_SCHOOL_STATS = "SchoolStats"
CATEGORY_ACCREDITATION = "Accreditation"

CONTRIBUTION_CATEGORIES = (
    CATEGORY_PROGRAM_DISCOVERY,
    CATEGORY_PRICING,
    CATEGORY_RANKING,
    CATEGORY_CAPACITY,
    CATEGORY_SCHOOL_STATS,
    CATEGORY_ACCREDITATION,
)

# Catégories qu'un visiteur peut soumettre. Program_Discovery en est exclue :
# elle n'est produite que par la Phase 1.
PUBLIC_CONTRIBUTION_CATEGORIES = (
    CATEGORY_PRICING,
    CATEGORY_RANKING,
    CATEGORY_CAPACITY,
    CATEGORY_SCHOOL_STATS,
    CATEGORY_ACCREDITATION,
)

# ── Origine d'un ticket ───────────────────────────────────────────
SOURCE_USER_SUBMISSION = "User_Submission"
SOURCE_AUTOMATED_AI = "Automated_AI"

CONTRIBUTION_SOURCE_TYPES = (SOURCE_USER_SUBMISSION, SOURCE_AUTOMATED_AI)
