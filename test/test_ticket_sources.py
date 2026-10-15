"""
Trois sources par ticket du pipeline (tâche hors plan « trois sources »).

Décisions du propriétaire du 15 octobre 2026 (journal du plan backend-local,
§11) : le bloc « Sources » d'un ticket `Automated_AI` porte au plus 3 liens,
choisis dans cet ordre, sans doublon : les URL citées par les données extraites,
puis le domaine officiel de l'école (et la page catalogue en Phase 1), puis le
reste, dans l'ordre de Tavily. En Phase 1, la première page catalogue tient la
première place : sans cette réserve, vingt programmes cités chacun par sa page
prendraient les trois places. La coupe se fait à l'écriture, par une seule
fonction : `backend/pipeline/ticket_sources.py`. L'inbox plafonne en plus les
tickets déjà en base (`lib/ticket-sources.ts`), et les deux implémentations
lisent `test/fixtures/ticket_sources_cases.json`.

Ne sont pas coupés : le rapport rangé, dont la liste sert à la reprise ; les
liens par ligne (`source_url` d'un programme, d'un classement…), qui restent
dans la charge ; les contributions du public.

Ni base ni réseau : les tickets sont lus dans les paramètres des INSERT.
"""

import json
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.ai.gemini_client import GeminiError
from backend.pipeline import campus_attachment_collector, phase1_research, phase2_research
from backend.pipeline.campus_attachment_collector import SchoolSnapshot, run_campus_attachment_step
from backend.pipeline.ticket_sources import (
    MAX_TICKET_SOURCES,
    cited_urls,
    is_official_url,
    select_ticket_sources,
    url_key,
)
from backend.tavily_service.catalog_client import CatalogResult

ROOT = Path(__file__).resolve().parent.parent
CASES = json.loads((Path(__file__).parent / "fixtures" / "ticket_sources_cases.json").read_text(encoding="utf-8"))


# ── Les cas partagés avec la suite TypeScript ────────────────────────


@pytest.mark.parametrize("case", CASES["cases"], ids=lambda c: c["name"])
def test_selection_cas_partages(case):
    got = select_ticket_sources(
        case["reservoir"],
        case["payload"],
        official_domain=case["official_domain"],
        priority_urls=case["priority_urls"],
        limit=case["limit"],
    )
    assert got == case["expected"]


@pytest.mark.parametrize("case", CASES["cited"], ids=lambda c: c["name"])
def test_urls_citees_cas_partages(case):
    assert cited_urls(case["payload"]) == case["expected"]


@pytest.mark.parametrize(
    "case", CASES["official"], ids=lambda c: f'{c["url"]} | {c["official_domain"]}'
)
def test_domaine_officiel_cas_partages(case):
    assert is_official_url(case["url"], case["official_domain"]) is case["official"]


@pytest.mark.parametrize("case", CASES["same_url"], ids=lambda c: f'{c["a"]} | {c["b"]}')
def test_doublons_cas_partages(case):
    key_a, key_b = url_key(case["a"]), url_key(case["b"])
    assert key_a is not None and key_b is not None
    assert (key_a == key_b) is case["same"]


def test_le_fichier_de_cas_couvre_les_regles():
    # Chaque règle du prompt a son cas : un fichier vidé par mégarde ne doit
    # pas laisser passer les deux suites.
    names = " / ".join(c["name"] for c in CASES["cases"])
    for rule in ("ordre", "doublons", "doublons www", "sous-domaine", "moins de 3", "ecartees",
                 "seul lien", "douze sources", "25 programmes", "repli sur la racine",
                 "rattachement campus"):
        assert rule in names, rule
    assert len(CASES["official"]) >= 15 and len(CASES["same_url"]) >= 10


def test_trois_par_defaut():
    assert MAX_TICKET_SOURCES == 3
    reservoir = [f"https://www.letudiant.fr/{i}" for i in range(12)]
    assert select_ticket_sources(reservoir, None, official_domain="em-lyon.com") == reservoir[:3]


def test_la_selection_ne_touche_pas_a_ses_entrees():
    reservoir = ["https://www.letudiant.fr/a", "https://www.em-lyon.com/b"]
    payload = {"source_url": "https://www.em-lyon.com/c"}
    priority = ["https://www.em-lyon.com/programmes"]
    select_ticket_sources(reservoir, payload, official_domain="em-lyon.com", priority_urls=priority)
    assert reservoir == ["https://www.letudiant.fr/a", "https://www.em-lyon.com/b"]
    assert payload == {"source_url": "https://www.em-lyon.com/c"}
    assert priority == ["https://www.em-lyon.com/programmes"]


# ── Phase 2 ─────────────────────────────────────────────────────────

NORMANDIE = {"id": "s-normandie", "name": "Em Normandie", "official_domain": "www.em-normandie.com", "status": "ACTIVE"}
TWELVE_SOURCES = next(c for c in CASES["cases"] if "douze sources" in c["name"])


class Phase2DB:
    """La base d'une Phase 2 : l'école, aucun programme, aucune donnée en production."""

    def __init__(self):
        self.tickets: list[dict] = []

    @contextmanager
    def connection(self):
        yield self

    def cursor(self, cursor_factory=None):
        db = self

        class Cursor:
            _row = None

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(self, sql, params=()):
                self._row = None
                if sql.lstrip().startswith('INSERT INTO "ContributionInbox"'):
                    (_id, _school, _campus, program_id, _pc, category, payload, _ya, _conflict,
                     urls, _group, _raw) = params
                    db.tickets.append({
                        "category": category, "programId": program_id,
                        "payload": json.loads(payload), "urls": urls,
                    })
                elif 'FROM "School"' in sql:
                    self._row = NORMANDIE

            def fetchone(self):
                return self._row

            def fetchall(self):
                return []

        return Cursor()


def test_phase2_douze_sources_trois_liens_avec_le_domaine_de_la_base(monkeypatch):
    """La passe réelle : le domaine officiel vient de `School`, jusqu'à `_insert_ticket`."""
    db = Phase2DB()
    monkeypatch.setattr("backend.db.get_db_connection", db.connection)
    monkeypatch.setattr(
        phase2_research, "create_research_task",
        lambda **_kw: {"report": "## SchoolStats", "sources": [{"url": u} for u in TWELVE_SOURCES["reservoir"]]},
    )
    stats = {"academic_year": 2027, "total_students": 9000, "source_url": TWELVE_SOURCES["payload"]["source_url"]}
    monkeypatch.setattr(phase2_research, "extract_structured", lambda **_kw: dict(stats))

    result = phase2_research.run_phase2_research("s-normandie", "key-manager", target_categories=["SchoolStats"])

    assert result["success"] is True and result["tickets_created"] == 1
    assert len(TWELVE_SOURCES["reservoir"]) == 12
    assert db.tickets[0]["urls"] == TWELVE_SOURCES["expected"]


class Phase2Inbox:
    """Recueille les INSERT de `_insert_ticket` (même forme que test_phase2_writers.py)."""

    def __init__(self):
        self.tickets: list[dict] = []

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
                inbox.tickets.append({"payload": json.loads(params[6]), "urls": params[9]})

        return Cursor()


@pytest.fixture
def inbox(monkeypatch):
    db = Phase2Inbox()
    monkeypatch.setattr("backend.db.get_db_connection", db.connection)
    return db


REPORT_SOURCES = [f"https://www.letudiant.fr/em-normandie/{i}" for i in range(10)] + [
    "https://www.em-normandie.com/fr/classements",
    "https://en.em-normandie.com/rankings",
]
PROGRAMS = [{"id": "p-pge", "name": "Programme Grande École"}]


def test_phase2_un_classement_qui_porte_son_url_garde_ce_seul_lien(inbox, monkeypatch):
    monkeypatch.setattr(phase2_research, "_get_existing_rankings", lambda ids: {})
    phase2_research._write_ranking_tickets(
        extracted={"rankings": [
            {"ranking_name": "Financial Times", "rank": 32, "academic_year": 2026, "scope": "program",
             "program_hint": "Programme Grande École", "source_url": "https://rankings.ft.com/mim"},
            {"ranking_name": "Le Figaro Étudiant", "rank": 3, "academic_year": 2026, "scope": "program",
             "program_hint": "Programme Grande École"},
        ]},
        school_id="s-normandie", programs=PROGRAMS, source_urls=REPORT_SOURCES,
        raw_report="R", official_domain="www.em-normandie.com",
    )

    assert inbox.tickets[0]["urls"] == ["https://rankings.ft.com/mim"]
    # Sans URL propre, celles du rapport : l'officiel d'abord, puis l'ordre de Tavily.
    assert inbox.tickets[1]["urls"] == [
        "https://www.em-normandie.com/fr/classements",
        "https://en.em-normandie.com/rankings",
        "https://www.letudiant.fr/em-normandie/0",
    ]
    # Le lien par ligne reste dans la charge.
    assert inbox.tickets[0]["payload"]["source_url"] == "https://rankings.ft.com/mim"


def test_phase2_capacity_douze_sources_trois_liens(inbox, monkeypatch):
    monkeypatch.setattr(phase2_research, "_get_existing_capacity_record", lambda pc_id: None)
    phase2_research._write_capacity_ticket(
        extracted={"capacities": [
            {"academic_year": 2026, "spots_available": 120, "source_url": "https://www.concours-sesame.net/places"},
        ]},
        school_id="s-normandie",
        program_campus={"program_campus_id": "pc-1", "program_id": "p-pge", "campus_id": "c-caen",
                        "program_name": "Programme Grande École", "campus_name": "Caen"},
        source_urls=REPORT_SOURCES, raw_report="R", official_domain="www.em-normandie.com",
    )

    assert inbox.tickets[0]["urls"] == [
        "https://www.concours-sesame.net/places",
        "https://www.em-normandie.com/fr/classements",
        "https://en.em-normandie.com/rankings",
    ]


def test_phase2_insert_ticket_exige_le_domaine_officiel(inbox):
    # Un oubli ne doit pas passer en silence : sans domaine, le groupe
    # « officiel » disparaîtrait de la sélection.
    with pytest.raises(TypeError):
        phase2_research._insert_ticket(
            category="SchoolStats", school_id="s", payload={}, source_urls=REPORT_SOURCES, raw_report="R",
        )


# ── Phase 1 ─────────────────────────────────────────────────────────

ESSCA = {"id": "s-essca", "name": "ESSCA", "official_domain": "www.essca.eu/", "status": "ACTIVE"}
CATALOG_URLS = ["https://www.essca.eu/programmes", "https://www.essca.eu/programmes/formation-continue"]
RESEARCH_SOURCES = [f"https://www.letudiant.fr/essca/{i}" for i in range(9)] + [
    "https://www.essca.eu/en/10-campuses-around-the-world",
    "https://www.essca.eu/en/10-campuses-around-the-world/paris",
    "https://www.essca.eu/en/10-campuses-around-the-world/angers",
]
REPORT = "## ESSCA\nCampus de Paris : Bachelor, PGE…"


def _discovery(programs_per_campus: int = 13, with_urls: bool = True) -> dict:
    campuses = []
    index = 0
    for campus in ("Campus Paris", "Campus Angers"):
        programs = []
        for _ in range(programs_per_campus):
            index += 1
            program = {"name": f"MSc Spécialisé {index:02d}"}
            if with_urls:
                program["source_url"] = f"https://www.essca.eu/programmes/msc-{index:02d}"
            programs.append(program)
        campuses.append({"name": campus, "city": campus.split()[-1], "programs": programs})
    return {"discovered_campuses": campuses, "source_urls": RESEARCH_SOURCES[-3:], "confidence_notes": None}


class Phase1DB:
    """La base d'une découverte : l'école, un rapport rangé éventuel, rien d'autre."""

    def __init__(self, school=ESSCA, parked=None):
        self.school = school
        self.parked = parked
        self.statements: list[tuple[str, tuple]] = []

    @contextmanager
    def connection(self):
        yield self

    def cursor(self, cursor_factory=None):
        db = self

        class Cursor:
            _row = None

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(self, sql, params=()):
                db.statements.append((" ".join(sql.split()), tuple(params)))
                if 'FROM "School"' in sql:
                    self._row = db.school
                elif "parked_reason" in sql and sql.lstrip().upper().startswith("SELECT"):
                    self._row = db.parked
                else:
                    self._row = None

            def fetchone(self):
                return self._row

            def fetchall(self):
                return []

        return Cursor()

    def pending_urls(self) -> list[list[str]]:
        # (id, schoolId, ai_category, json, urls, createdAt, raw_report)
        return [p[4] for s, p in self.statements if s.startswith("INSERT") and "'Pending_Admin'" in s]

    def parked_urls(self) -> list[list[str]]:
        # (id, schoolId, ai_category, json, status, urls, createdAt, raw_report)
        return [p[5] for s, p in self.statements if s.startswith("INSERT") and "'Pending_Admin'" not in s]


def _run_phase1(db: Phase1DB, extraction, catalog_urls=None, sources=None):
    catalog = CatalogResult(urls=list(catalog_urls), content="# Nos formations") if catalog_urls else None
    research = {"report": REPORT, "sources": [{"url": u} for u in (RESEARCH_SOURCES if sources is None else sources)]}
    extract = (
        {"side_effect": extraction} if isinstance(extraction, Exception) else {"return_value": extraction}
    )
    with patch("backend.db.get_db_connection", db.connection), \
            patch.object(phase1_research, "fetch_catalog", return_value=catalog), \
            patch.object(phase1_research, "_extract_catalog_titles", return_value=[]), \
            patch.object(phase1_research, "create_research_task", return_value=research) as research_mock, \
            patch.object(phase1_research, "extract_structured", **extract):
        result = phase1_research.run_phase1_research(db.school["id"], "key-manager")
    return result, research_mock


def test_phase1_le_catalogue_garde_la_premiere_place_devant_25_programmes_cites():
    """Décision du propriétaire (journal, dernière ligne du 15 octobre)."""
    db = Phase1DB()
    discovery = _discovery()
    assert sum(len(c["programs"]) for c in discovery["discovered_campuses"]) >= 25

    result, _ = _run_phase1(db, discovery, catalog_urls=CATALOG_URLS)

    assert result["success"] is True
    assert db.pending_urls() == [[
        "https://www.essca.eu/programmes",
        "https://www.essca.eu/programmes/msc-01",
        "https://www.essca.eu/programmes/msc-02",
    ]]


def test_phase1_les_liens_par_ligne_restent_dans_la_charge():
    db = Phase1DB()
    _run_phase1(db, _discovery(), catalog_urls=CATALOG_URLS)

    payload = json.loads(next(p[3] for s, p in db.statements if "'Pending_Admin'" in s))
    programs = [p for c in payload["discovered_campuses"] for p in c["programs"]]
    assert len(programs) == 26
    assert all(p["source_url"].startswith("https://www.essca.eu/programmes/msc-") for p in programs)
    assert payload["source_urls"] == RESEARCH_SOURCES[-3:]


def test_phase1_sans_catalogue_ni_citation_l_officiel_puis_tavily():
    db = Phase1DB()
    discovery = _discovery(with_urls=False)
    discovery["source_urls"] = []
    _run_phase1(db, discovery)

    assert db.pending_urls() == [[
        "https://www.essca.eu/en/10-campuses-around-the-world",
        "https://www.essca.eu/en/10-campuses-around-the-world/paris",
        "https://www.essca.eu/en/10-campuses-around-the-world/angers",
    ]]


def test_phase1_le_repli_sur_la_racine_du_domaine_reste():
    db = Phase1DB(school={"id": "s-emlv", "name": "EMLV", "official_domain": "emlv.fr", "status": "ACTIVE"})
    discovery = _discovery(with_urls=False)
    discovery["source_urls"] = []
    _run_phase1(db, discovery, sources=[])

    assert db.pending_urls() == [["https://emlv.fr"]]


def test_phase1_le_rapport_range_garde_sa_liste_entiere():
    """Sa liste sert à la reprise : la couper ôterait de quoi choisir ensuite."""
    db = Phase1DB()
    result, _ = _run_phase1(db, GeminiError("503 high demand"), catalog_urls=CATALOG_URLS)

    assert result["success"] is False
    assert db.parked_urls() == [RESEARCH_SOURCES]
    assert len(RESEARCH_SOURCES) == 12


def test_phase1_un_nouvel_echec_ne_touche_pas_a_la_liste_du_rapport_range():
    parked = {"id": "parked-1", "raw_report": REPORT, "urls": RESEARCH_SOURCES,
              "createdAt": datetime(2026, 10, 15, 9, 0)}
    db = Phase1DB(parked=parked)
    _run_phase1(db, GeminiError("503 encore"), catalog_urls=CATALOG_URLS)

    updates = [s for s, _ in db.statements if s.startswith("UPDATE")]
    assert len(updates) == 1 and "urls" not in updates[0]
    assert db.parked_urls() == []


def test_phase1_la_reprise_d_un_rapport_range_ecrit_un_ticket_a_trois_sources():
    parked = {"id": "parked-1", "raw_report": REPORT, "urls": list(RESEARCH_SOURCES),
              "createdAt": datetime(2026, 10, 15, 9, 0)}
    db = Phase1DB(parked=parked)
    discovery = _discovery(programs_per_campus=1)

    result, research = _run_phase1(db, discovery, catalog_urls=CATALOG_URLS)

    assert research.call_count == 0 and result["research_report_reused"] is True
    assert db.pending_urls() == [[
        "https://www.essca.eu/programmes",
        "https://www.essca.eu/programmes/msc-01",
        "https://www.essca.eu/programmes/msc-02",
    ]]


def test_phase1_reprise_sans_catalogue_ni_citation():
    parked = {"id": "parked-1", "raw_report": REPORT, "urls": list(RESEARCH_SOURCES),
              "createdAt": datetime(2026, 10, 15, 9, 0)}
    db = Phase1DB(parked=parked)
    discovery = _discovery(programs_per_campus=1, with_urls=False)
    discovery["source_urls"] = []

    _run_phase1(db, discovery)

    urls = db.pending_urls()
    assert len(urls) == 1 and len(urls[0]) == 3
    assert urls[0] == RESEARCH_SOURCES[-3:]


# ── Rattachement campus ─────────────────────────────────────────────

NORMANDIE_SNAPSHOT = SchoolSnapshot(
    school_id="s-normandie", name="Em Normandie", official_domain="www.em-normandie.com",
    campuses=[{"id": "c-caen", "name": "Caen"}],
    programs=[{"id": "p-pge", "name": "Programme Grande École", "campus_policy_note": None}],
)
FICHES = [f"https://www.em-normandie.com/programmes/fiche-{i}" for i in range(1, 6)]


def test_rattachement_les_trois_premieres_fiches_citees(monkeypatch):
    claims = [
        {"programId": "p-pge", "campusId": "c-caen", "study_year": year, "source_url": url}
        for year, url in [(1, FICHES[4]), (2, FICHES[4]), (3, FICHES[2]), (4, FICHES[0]), (5, FICHES[3])]
    ]
    monkeypatch.setattr(campus_attachment_collector, "collect_campus_rows", lambda io, **kw: {
        "programs": [{}], "totals": {},
        "run": {"index_pages": ["https://www.em-normandie.com/programmes"], "pages_read": FICHES,
                "tavily_credits_this_run": 0, "extraction_failures": []},
    })
    monkeypatch.setattr(campus_attachment_collector, "build_attachment_claims", lambda f, s: (claims, []))
    monkeypatch.setattr(campus_attachment_collector, "build_policy_note_claims", lambda f, s: ([], []))
    monkeypatch.setattr(campus_attachment_collector, "plan_ticket_writes",
                        lambda ticket, s: {"counts": {"attachments": {"create": 5}}, "writes": 5})
    emitted = []

    def emit(payload, urls):
        emitted.append((payload, urls))
        return "ticket-1"

    out = run_campus_attachment_step(NORMANDIE_SNAPSHOT, None, ["https://www.em-normandie.com/programmes"], emit)

    assert out["status"] == "ticket_emitted"
    payload, urls = emitted[0]
    # Ordre des lignes, plus l'ordre alphabétique d'avant ; aucune réserve
    # pour la page catalogue (décision du propriétaire).
    assert urls == [FICHES[4], FICHES[2], FICHES[0]]
    assert [c["source_url"] for c in payload["campus_attachments"]] == [c["source_url"] for c in claims]


# ── Contributions du public : jamais coupées ─────────────────────────


def test_le_crowdsourcing_n_importe_pas_la_coupe():
    for path in (ROOT / "backend" / "crowdsourcing").rglob("*.py"):
        assert "ticket_sources" not in path.read_text(encoding="utf-8"), path


def test_une_contribution_a_cinq_urls_les_garde_toutes():
    from backend.crowdsourcing import processor

    urls = [f"https://www.em-lyon.com/fr/accreditations/{i}" for i in range(5)]
    ticket = {
        "id": "contrib-1", "user_text": None, "urls": urls, "ai_category": "Accreditation",
        "school_id": "s-lyon", "program_id": None, "school_name": "Em Lyon",
    }
    db = MagicMock()
    db.__enter__.return_value.cursor.return_value.__enter__.return_value.fetchone.return_value = ticket

    def forbidden(*_a, **_kw):
        raise AssertionError("une contribution ne passe pas par la coupe à trois sources")

    with patch("backend.db.get_db_connection", return_value=db), \
            patch("backend.pipeline.ticket_sources.select_ticket_sources", forbidden), \
            patch.object(processor, "extract_from_urls", return_value="Accréditations : EQUIS, AACSB, AMBA. " * 5) as extract, \
            patch.object(processor, "_extract_with_cascade", side_effect=[
                {"compatible": True, "reason": "ok"},
                {"accreditations": [{"accreditation_name": "EQUIS", "source_url": urls[0]}]},
            ]):
        processor.process_crowdsourcing_ticket("contrib-1", "key-manager")

    assert extract.call_args.args[0] == urls
    cursor = db.__enter__.return_value.cursor.return_value.__enter__.return_value
    updates = [" ".join(c.args[0].split()) for c in cursor.execute.call_args_list if "UPDATE" in c.args[0]]
    assert len(updates) == 1 and "SET status = 'Pending_Admin'" in updates[0]
    assert "urls" not in updates[0], "le traitement ne réécrit jamais les URL d'une contribution"
