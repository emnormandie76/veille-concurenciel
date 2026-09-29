"""
Phase 1 : ne proposer que ce qui est nouveau.

Relancée sur une école déjà cartographiée, la Phase 1 rendait un ticket avec
tous les programmes ; et `validateProgramDiscovery` fait un `upsert` sur le nom
exact, si bien que « Programme Grande Ecole » face à « Programme Grande École »
créait un second `Program`. Ces tests tiennent le tri de
backend/pipeline/discovery_diff.py et son branchement dans
`_run_program_discovery` (docs/features/cron-rotation-production.md, étape 2).

Les noms sont ceux d'Em Normandie en base.
"""

import json
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import patch

from backend.pipeline import phase1_research
from backend.pipeline.discovery_diff import filter_new_discoveries

CAMPUSES = [
    {"id": "c-caen", "name": "Caen"},
    {"id": "c-havre", "name": "Le Havre"},
    {"id": "c-paris", "name": "Paris"},
    {"id": "c-dubai", "name": "Dubaï"},
]
PGE = {"id": "p-pge", "name": "Programme Grande École"}
BACHELOR = {"id": "p-bm", "name": "Bachelor Management"}
IBBA = {"id": "p-ibba", "name": "International Bachelor in Business Administration"}
MSC = {"id": "p-msc", "name": "Master of Science (MSc) - Banking, Finance and FinTech"}
PROGRAMS = [PGE, BACHELOR, IBBA, MSC]
EDGES = {
    ("p-pge", "c-caen"),
    ("p-pge", "c-havre"),
    ("p-bm", "c-caen"),
    ("p-ibba", "c-paris"),
}


def _campus(name, *programs, city=None):
    return {
        "name": name,
        "city": city,
        "programs": [
            {"name": p, "admission_exam": None, "is_alternance_possible": None,
             "is_expatriation_mandatory": None}
            for p in programs
        ],
    }


def _names(campuses):
    return [(c["name"], [p["name"] for p in c["programs"]]) for c in campuses]


def _filter(discovered, campuses=CAMPUSES, programs=PROGRAMS, edges=EDGES):
    return filter_new_discoveries(discovered, campuses, programs, edges)


# --- Le tri ------------------------------------------------------------------

def test_base_vide_la_sortie_est_l_entree():
    discovered = [
        _campus("Caen", "Programme Grande École", "Bachelor Management", city="Caen"),
        _campus("Dubaï", "International Bachelor in Business Administration", city="Dubaï"),
    ]
    kept, summary = _filter(discovered, campuses=[], programs=[], edges=set())

    assert kept == discovered
    assert summary == {
        "campuses_known": 0, "programs_known": 0, "pairs_already_in_base": 0,
        "ambiguous_programs": [], "ambiguous_campuses": [],
    }


def test_tout_est_deja_en_base():
    discovered = [
        _campus("Caen", "Programme Grande École", "Bachelor Management"),
        _campus("Le Havre", "Programme Grande École"),
        _campus("Paris", "IBBA (International Bachelor in Business Administration)"),
    ]
    kept, summary = _filter(discovered)

    assert kept == []
    assert summary["pairs_already_in_base"] == 4
    assert summary["campuses_known"] == 3
    assert summary["programs_known"] == 3


def test_une_autre_orthographe_est_reecrite_et_retiree_si_le_couple_existe():
    discovered = [
        _campus("Caen", "Programme Grande Ecole"),   # arête en base
        _campus("Paris", "Programme Grande Ecole"),  # arête absente
    ]
    kept, summary = _filter(discovered)

    assert _names(kept) == [("Paris", ["Programme Grande École"])]
    assert summary["pairs_already_in_base"] == 1


def test_un_programme_connu_sur_un_nouveau_campus_est_garde_et_reecrit():
    discovered = [_campus("Caen", "IBBA (International Bachelor in Business Administration)")]
    kept, _ = _filter(discovered)

    assert _names(kept) == [("Caen", ["International Bachelor in Business Administration"])]


def test_un_programme_nouveau_sur_un_campus_connu_reecrit_le_campus():
    discovered = [_campus("Dubai Campus", "Bachelor Management, Data et IA Responsables", city="Dubaï")]
    kept, summary = _filter(discovered)

    assert _names(kept) == [("Dubaï", ["Bachelor Management, Data et IA Responsables"])]
    assert kept[0]["city"] == "Dubaï", "le reste du campus découvert est conservé"
    assert summary["campuses_known"] == 1
    assert summary["programs_known"] == 0


def test_un_programme_ambigu_est_garde_tel_quel_et_signale():
    # Le doublon que l'ancien upsert créait : deux Program de même forme canonique.
    doublon = {"id": "p-pge-2", "name": "Programme Grande Ecole"}
    discovered = [_campus("Caen", "Programme Grande École")]
    kept, summary = _filter(discovered, programs=PROGRAMS + [doublon])

    assert _names(kept) == [("Caen", ["Programme Grande École"])]
    assert summary["ambiguous_programs"] == [{
        "name": "Programme Grande École",
        "campus": "Caen",
        "candidates": ["Programme Grande Ecole", "Programme Grande École"],
    }]
    assert summary["pairs_already_in_base"] == 0


def test_un_campus_ambigu_est_garde_tel_quel_et_signale():
    campuses = CAMPUSES + [{"id": "c-paris-2", "name": "Campus Paris"}]
    discovered = [_campus("Paris", "International Bachelor in Business Administration")]
    kept, summary = _filter(discovered, campuses=campuses)

    assert _names(kept) == [("Paris", ["International Bachelor in Business Administration"])]
    assert summary["ambiguous_campuses"] == [{"name": "Paris", "candidates": ["Campus Paris", "Paris"]}]


def test_deux_voies_du_meme_programme_sur_un_campus_font_une_entree():
    discovered = [_campus(
        "Paris",
        "Programme Grande École en 5 ans",
        "Programme Grande École en 2 ou 3 ans",
    )]
    kept, _ = _filter(discovered)

    assert _names(kept) == [("Paris", ["Programme Grande École"])]


def test_l_entree_n_est_pas_modifiee():
    discovered = [_campus("Caen Campus", "Programme Grande Ecole", "IBBA (International Bachelor in Business Administration)")]
    before = json.loads(json.dumps(discovered))
    _filter(discovered)
    assert discovered == before


# --- Le branchement dans la découverte --------------------------------------

SCHOOL = {"id": "s1", "name": "Em Normandie", "official_domain": "www.em-normandie.com", "status": "ACTIVE"}
REPORT = "## Em Normandie\nCampus de Caen : Programme Grande École, Bachelor Management..."
PARKED = {
    "id": "parked-1",
    "raw_report": REPORT,
    "urls": ["https://www.em-normandie.com/programmes"],
    "createdAt": datetime(2026, 9, 28, 10, 52, tzinfo=timezone.utc),
}
EDGE_ROWS = [
    {"id": f"e-{program_id}-{campus_id}", "programId": program_id, "campusId": campus_id}
    for program_id, campus_id in sorted(EDGES)
]


class FakeDB:
    """Une base réduite aux requêtes de la découverte et de la lecture du diff."""

    def __init__(self, parked=None):
        self.parked = parked
        self.statements: list[tuple[str, tuple]] = []

    @contextmanager
    def connection(self):
        yield self

    def cursor(self, cursor_factory=None):
        db = self

        class Cursor:
            _rows: list = []

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(self, sql, params=()):
                sql = " ".join(sql.split())
                db.statements.append((sql, tuple(params)))
                if 'FROM "School"' in sql:
                    self._rows = [SCHOOL]
                elif "parked_reason" in sql and sql.upper().startswith("SELECT"):
                    self._rows = [db.parked] if db.parked else []
                elif 'FROM "ProgramCampusAttachment"' in sql:
                    self._rows = []
                elif 'FROM "ProgramCampus"' in sql:
                    self._rows = EDGE_ROWS
                elif 'FROM "Campus"' in sql:
                    self._rows = CAMPUSES
                elif 'FROM "Program"' in sql:
                    self._rows = PROGRAMS
                else:
                    self._rows = []

            def fetchone(self):
                return self._rows[0] if self._rows else None

            def fetchall(self):
                return list(self._rows)

        return Cursor()

    def sql(self, keyword):
        return [(s, p) for s, p in self.statements if s.upper().startswith(keyword)]


def _discover(db, extracted):
    with patch("backend.db.get_db_connection", db.connection), \
            patch.object(phase1_research, "fetch_catalog", return_value=None), \
            patch.object(phase1_research, "create_research_task",
                         return_value={"report": REPORT, "sources": []}) as research, \
            patch.object(phase1_research, "extract_structured", return_value=extracted):
        result = phase1_research.run_phase1_research("s1", "key-manager")
    return result, research


def test_sans_nouveaute_aucun_ticket_et_le_rapport_range_est_consomme():
    db = FakeDB(parked=PARKED)
    extracted = {"discovered_campuses": [
        _campus("Caen", "Programme Grande Ecole", "Bachelor Management"),
        _campus("Le Havre", "Programme Grande École"),
    ]}
    result, research = _discover(db, extracted)

    assert research.call_count == 0
    assert db.sql("INSERT") == []
    assert db.sql("DELETE") == [
        ('DELETE FROM "ContributionInbox" WHERE id = %s AND status = %s', ("parked-1", "Failed"))
    ]
    assert result["success"] is True
    assert result["no_new_discoveries"] is True
    assert result["message"] == "Aucune nouveauté par rapport à la base"
    assert result["diff_against_base"]["pairs_already_in_base"] == 3


def test_avec_nouveaute_le_ticket_ne_porte_que_le_nouveau():
    db = FakeDB()
    extracted = {"discovered_campuses": [
        _campus("Caen", "Programme Grande Ecole", "International Bachelor in Business Administration"),
        _campus("Le Havre", "Programme Grande École"),
    ]}
    result, research = _discover(db, extracted)

    assert research.call_count == 1
    [(sql, params)] = db.sql("INSERT")
    payload = json.loads(params[3])
    assert _names(payload["discovered_campuses"]) == [
        ("Caen", ["International Bachelor in Business Administration"])
    ]
    assert payload["diff_against_base"]["pairs_already_in_base"] == 2
    assert result["success"] is True
    assert result["campuses_count"] == 1 and result["programs_count"] == 1


def test_une_base_illisible_depose_le_ticket_complet_comme_avant():
    db = FakeDB()
    extracted = {"discovered_campuses": [_campus("Caen", "Programme Grande École")]}
    with patch.object(phase1_research, "_read_discovery_base", return_value=None):
        result, _ = _discover(db, extracted)

    [(_, params)] = db.sql("INSERT")
    payload = json.loads(params[3])
    assert _names(payload["discovered_campuses"]) == [("Caen", ["Programme Grande École"])]
    assert "error" in payload["diff_against_base"]
    assert result["success"] is True
