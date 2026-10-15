"""
L'écriture des tickets de la Phase 2, hors F1 (backend/pipeline/phase2_research.py).

Plan backend-local, étape 7 (P1) :
- `ARRAY_RESULT_KEYS` : un rapport Ranking fait N tickets, reliés par un même
  `submission_group_id` ; Capacity, lui, ne se découpe pas (un ticket portant
  le tableau des voies, voir `_write_capacity_ticket`) ;
- `_include_domains_for` : le domaine de l'école pour Pricing (et SchoolStats,
  Accreditation), rien pour Ranking et Capacity, dont la donnée vit chez des
  tiers ;
- `_write_capacity_ticket`.

Ni base ni réseau : la production est rendue par des doublures, et les tickets
sont lus dans les paramètres de l'INSERT réel de `_insert_ticket`.
"""

import json
from contextlib import contextmanager

import pytest

from backend.ai.extraction_schemas import ARRAY_RESULT_KEYS
from backend.pipeline import phase2_research
from backend.pipeline.phase2_research import (
    _include_domains_for,
    _write_capacity_ticket,
    _write_ranking_tickets,
)

PROGRAMS = [
    {"id": "p-pge", "name": "Programme Grande École"},
    {"id": "p-msc", "name": "MSc Supply Chain"},
]


class Inbox:
    """Recueille les INSERT de `_insert_ticket`."""

    def __init__(self):
        self.tickets = []

    @contextmanager
    def connection(self):
        yield self

    def cursor(self, cursor_factory=None):
        inbox = self

        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(self, sql, params=()):
                assert 'INSERT INTO "ContributionInbox"' in sql
                (ticket_id, school_id, campus_id, program_id, program_campus_id, category,
                 payload, year_assumed, conflict, urls, group_id, raw_report) = params
                inbox.tickets.append({
                    "id": ticket_id, "schoolId": school_id, "campusId": campus_id,
                    "programId": program_id, "programCampusId": program_campus_id,
                    "category": category, "payload": json.loads(payload),
                    "year_assumed": year_assumed, "urls": urls,
                    "submission_group_id": group_id, "raw_report": raw_report,
                })

        return Cursor()


@pytest.fixture
def inbox(monkeypatch):
    db = Inbox()
    monkeypatch.setattr("backend.db.get_db_connection", db.connection)
    return db


def _ranking(name, rank, hint="Programme Grande École", year=2026, **extra):
    return {"ranking_name": name, "rank": rank, "academic_year": year,
            "scope": "program", "program_hint": hint, **extra}


# ── include_domains ──────────────────────────────────────────────────

def test_include_domains_pour_les_sources_de_l_ecole_seulement():
    assert _include_domains_for("Pricing", "em-normandie.com") == ["em-normandie.com"]
    assert _include_domains_for("SchoolStats", "em-normandie.com") == ["em-normandie.com"]
    assert _include_domains_for("Accreditation", "em-normandie.com") == ["em-normandie.com"]
    assert _include_domains_for("Ranking", "em-normandie.com") is None
    assert _include_domains_for("Capacity", "em-normandie.com") is None


# ── Ranking : N tickets, un même groupe ──────────────────────────────

def test_les_categories_a_tableau():
    assert ARRAY_RESULT_KEYS == {"Ranking": "rankings", "Capacity": "capacities"}


def test_un_ticket_par_classement_relies_par_un_meme_groupe(inbox, monkeypatch):
    monkeypatch.setattr(phase2_research, "_get_existing_rankings", lambda ids: {})

    created, unchanged = _write_ranking_tickets(
        extracted={"rankings": [
            _ranking("Financial Times", 32, source_url="https://rankings.ft.com/mim"),
            _ranking("Le Figaro", 11),
            _ranking("Les Echos", 9, hint="MSc Supply Chain"),
        ]},
        school_id="s-normandie", programs=PROGRAMS,
        source_urls=["https://rapport/1", "https://rapport/2"], raw_report="RAPPORT",
    )

    assert (created, unchanged) == (3, 0)
    groups = {t["submission_group_id"] for t in inbox.tickets}
    assert len(groups) == 1 and None not in groups
    assert [t["programId"] for t in inbox.tickets] == ["p-pge", "p-pge", "p-msc"]
    assert all(t["category"] == "Ranking" and t["raw_report"] == "RAPPORT" for t in inbox.tickets)
    # L'URL propre au classement prime ; à défaut, celles du rapport.
    assert inbox.tickets[0]["urls"] == ["https://rankings.ft.com/mim"]
    assert inbox.tickets[1]["urls"] == ["https://rapport/1", "https://rapport/2"]


def test_deux_rapports_deux_groupes(inbox, monkeypatch):
    monkeypatch.setattr(phase2_research, "_get_existing_rankings", lambda ids: {})
    for rank in (32, 33):
        _write_ranking_tickets(
            extracted={"rankings": [_ranking("Financial Times", rank)]},
            school_id="s-normandie", programs=PROGRAMS, source_urls=[], raw_report="R",
        )

    assert len({t["submission_group_id"] for t in inbox.tickets}) == 2


def test_ce_qui_n_est_pas_ecrit_ne_fait_pas_de_ticket(inbox, monkeypatch):
    production = {("p-pge", 2026, "Challenges"): {"academic_year": 2026, "ranking_name": "Challenges", "rank": 5}}
    monkeypatch.setattr(phase2_research, "_get_existing_rankings", lambda ids: production)

    created, unchanged = _write_ranking_tickets(
        extracted={"rankings": [
            _ranking("Classement école", 3, scope="school"),          # niveau école
            _ranking("Le Point", 7, hint="Bachelor inconnu"),           # non rattaché
            _ranking("Autre", 12),                                      # écrit
            _ranking("Autre", 14),                                      # même clé : doublon
            _ranking("Challenges", 5),                                  # identique à la production
            "pas un dict",
        ]},
        school_id="s-normandie", programs=PROGRAMS, source_urls=[], raw_report="R",
    )

    assert (created, unchanged) == (1, 1)
    assert [t["payload"]["rank"] for t in inbox.tickets] == [12]


def test_une_extraction_ranking_vide_ne_fait_rien(inbox, monkeypatch):
    monkeypatch.setattr(phase2_research, "_get_existing_rankings", lambda ids: pytest.fail("pas de lecture"))

    for extracted in ({}, {"rankings": []}, {"rankings": "texte"}):
        assert _write_ranking_tickets(
            extracted=extracted, school_id="s", programs=PROGRAMS, source_urls=[], raw_report="R",
        ) == (0, 0)
    assert inbox.tickets == []


# ── Capacity : un ticket, le tableau des voies ───────────────────────

PROGRAM_CAMPUS = {
    "program_campus_id": "pc-bachelor-caen", "program_id": "p-bachelor", "campus_id": "c-caen",
    "program_name": "Bachelor", "campus_name": "Caen",
}


def test_capacity_un_seul_ticket_portant_toutes_les_voies(inbox, monkeypatch):
    monkeypatch.setattr(phase2_research, "_get_existing_capacity_record", lambda pc_id: None)
    capacities = [
        {"academic_year": 2027, "spots_available": 80, "admission_channel": "SESAME"},
        {"academic_year": 2027, "spots_available": 40, "admission_channel": "Parcoursup", "year_assumed": True},
    ]

    result = _write_capacity_ticket(
        extracted={"capacities": capacities}, school_id="s-normandie",
        program_campus=PROGRAM_CAMPUS, source_urls=["https://x"], raw_report="R",
    )

    assert result == (1, 0)
    [ticket] = inbox.tickets
    assert ticket["category"] == "Capacity"
    assert (ticket["programCampusId"], ticket["programId"], ticket["campusId"]) == (
        "pc-bachelor-caen", "p-bachelor", "c-caen")
    assert ticket["payload"]["capacities"] == capacities
    # Une seule voie à l'année supposée suffit à marquer le ticket.
    assert ticket["year_assumed"] is True
    assert ticket["submission_group_id"] is None


def test_capacity_inchangee_aucun_ticket(inbox, monkeypatch):
    monkeypatch.setattr(
        phase2_research, "_get_existing_capacity_record",
        lambda pc_id: {"academic_year": 2027, "spots_available": 120},
    )

    result = _write_capacity_ticket(
        extracted={"capacities": [
            {"academic_year": 2026, "spots_available": 90},
            {"academic_year": 2027, "spots_available": 120},
        ]},
        school_id="s", program_campus=PROGRAM_CAMPUS, source_urls=[], raw_report="R",
    )

    assert result == (0, 1)
    assert inbox.tickets == []


def test_capacity_changee_sur_l_annee_la_plus_recente(inbox, monkeypatch):
    monkeypatch.setattr(
        phase2_research, "_get_existing_capacity_record",
        lambda pc_id: {"academic_year": 2026, "spots_available": 120},
    )

    result = _write_capacity_ticket(
        extracted={"capacities": [{"academic_year": 2027, "spots_available": 120}]},
        school_id="s", program_campus=PROGRAM_CAMPUS, source_urls=[], raw_report="R",
    )

    assert result == (1, 0)


def test_capacity_vide_aucun_ticket(inbox, monkeypatch):
    monkeypatch.setattr(phase2_research, "_get_existing_capacity_record", lambda pc_id: None)

    for extracted in ({}, {"capacities": []}, {"capacities": ["pas un dict"]}):
        assert _write_capacity_ticket(
            extracted=extracted, school_id="s", program_campus=PROGRAM_CAMPUS,
            source_urls=[], raw_report="R",
        ) == (0, 0)
    assert inbox.tickets == []
