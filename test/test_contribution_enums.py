"""
Parité des énumérations de la zone tampon.

Les statuts, catégories et types de source existent en trois exemplaires : la
liste TypeScript (`lib/contribution.ts`), la liste Python (`backend/constants.py`)
et les contraintes CHECK en base (migration
20260902120000_inbox_relations_and_enum_guards). Rien dans le langage ne peut les
tenir ensemble — c'est le prix d'un pipeline à deux langages.

Ce test est ce qui les tient ensemble. Ajouter une valeur d'un seul côté le fait
échouer, ce qui est précisément le rappel manquant.
"""

import os
import re
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.constants import (  # noqa: E402
    CONTRIBUTION_CATEGORIES,
    CONTRIBUTION_SOURCE_TYPES,
    CONTRIBUTION_STATUSES,
    PUBLIC_CONTRIBUTION_CATEGORIES,
)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TS_FILE = os.path.join(ROOT, "lib", "contribution.ts")
MIGRATION_FILE = os.path.join(
    ROOT,
    "prisma",
    "migrations",
    "20260902120000_inbox_relations_and_enum_guards",
    "migration.sql",
)


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def _ts_array(name: str) -> list[str]:
    """Extrait les littéraux d'un `export const NAME = [...] as const;`."""
    source = _read(TS_FILE)
    match = re.search(
        r"export const %s\s*=\s*\[(.*?)\]\s*as const;" % re.escape(name),
        source,
        re.DOTALL,
    )
    assert match, f"{name} introuvable dans lib/contribution.ts"
    return re.findall(r'"([^"]+)"', match.group(1))


def _sql_check_values(constraint: str) -> list[str]:
    """Extrait les valeurs d'une contrainte CHECK (... IN (...))."""
    source = _read(MIGRATION_FILE)
    match = re.search(
        r'ADD CONSTRAINT "%s"\s*CHECK\s*\([^)]*IN \(([^)]*)\)\)' % re.escape(constraint),
        source,
        re.DOTALL,
    )
    assert match, f"contrainte {constraint} introuvable dans la migration"
    return re.findall(r"'([^']+)'", match.group(1))


def test_statuses_match_between_python_and_typescript():
    assert list(CONTRIBUTION_STATUSES) == _ts_array("CONTRIBUTION_STATUSES")


def test_categories_match_between_python_and_typescript():
    assert list(CONTRIBUTION_CATEGORIES) == _ts_array("CONTRIBUTION_CATEGORIES")


def test_public_categories_match_between_python_and_typescript():
    assert list(PUBLIC_CONTRIBUTION_CATEGORIES) == _ts_array(
        "PUBLIC_CONTRIBUTION_CATEGORIES"
    )


def test_source_types_match_between_python_and_typescript():
    assert list(CONTRIBUTION_SOURCE_TYPES) == _ts_array("CONTRIBUTION_SOURCE_TYPES")


def test_database_constraints_match_the_shared_lists():
    """La base est la seule frontière que les deux langages partagent."""
    assert sorted(_sql_check_values("ContributionInbox_status_check")) == sorted(
        CONTRIBUTION_STATUSES
    )
    assert sorted(_sql_check_values("ContributionInbox_ai_category_check")) == sorted(
        CONTRIBUTION_CATEGORIES
    )
    assert sorted(_sql_check_values("ContributionInbox_source_type_check")) == sorted(
        CONTRIBUTION_SOURCE_TYPES
    )


def test_public_categories_are_a_subset_of_all_categories():
    """Program_Discovery n'est produite que par le pipeline, jamais soumise."""
    assert set(PUBLIC_CONTRIBUTION_CATEGORIES) < set(CONTRIBUTION_CATEGORIES)
    assert "Program_Discovery" not in PUBLIC_CONTRIBUTION_CATEGORIES
