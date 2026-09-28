"""
La collecte branchee : cache, refus avant depense, garde contre l'inondation, Phase 1.

Aucun test ne touche le reseau ni la base. Les appels sont des doubles qui
LEVENT quand ils ne devraient pas etre appeles : c'est ainsi qu'est prouve
qu'EMLV et Essec ne consomment rien, et que la Phase 1 ne lance pas la collecte
en dry_run.

EM Strasbourg n'est pas dans le cache du 4 septembre. Son cas est CONSTRUIT :
les noms de ses sept programmes et de son campus sont ceux de la base, et
l'encart de fiche reprend les champs releves le 3 septembre (Conditions
d'acces, Diplome obtenu, Langues, Rythme, Duree), sans aucun champ de lieu.
"""

import json
import os
import sys
import tempfile
import unittest
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.pipeline.campus_attachment_collector import (  # noqa: E402
    CacheMiss,
    CachedCollectorIO,
    SchoolSnapshot,
    collect_campus_rows,
    insert_attachment_ticket,
    read_school_snapshot,
    run_campus_attachment_step,
    snapshot_from_dump,
)


class ExplodingIO:
    """Un reseau qu'on ne doit pas appeler."""

    def __getattr__(self, name):
        raise AssertionError(f"appel reseau inattendu : {name}")


class ScriptedIO:
    """Un reseau joue d'avance, qui compte ce qu'on lui demande."""

    def __init__(self, mapped, pages, statements):
        self.mapped = mapped
        self.pages = pages
        self.statements = statements
        self.calls = []

    def find_catalog_pages(self, school_name, domain):
        raise AssertionError("la page catalogue est connue : aucun /search")

    def map_pages(self, root_url):
        self.calls.append(("map", root_url))
        return list(self.mapped), 5

    def extract(self, urls):
        self.calls.append(("extract", tuple(urls)))
        return "\n\n---\n\n".join(f"## Source: {u}\n\n{self.pages[u]}" for u in urls if u in self.pages)

    def extract_statements(self, urls, source_text):
        self.calls.append(("gemini", tuple(urls)))
        return self.statements(urls)


def recorder():
    emitted = []

    def emit(payload, urls):
        emitted.append({"payload": payload, "urls": urls})
        return f"ticket-{len(emitted)}"

    return emitted, emit


# ── Le cache ──────────────────────────────────────────────────────

class TestCachedCollectorIO(unittest.TestCase):
    def test_cache_only_refuses_to_pay_for_a_missing_answer(self):
        with tempfile.TemporaryDirectory() as tmp:
            io = CachedCollectorIO(tmp, inner=ExplodingIO(), cache_only=True)
            with self.assertRaises(CacheMiss):
                io.map_pages("https://www.em-normandie.com/programmes")

    def test_a_replayed_map_costs_this_run_nothing_but_keeps_its_price(self):
        with tempfile.TemporaryDirectory() as tmp:
            live = CachedCollectorIO(tmp, inner=ScriptedIO(["https://x.fr/p/a"], {}, lambda u: {}))
            self.assertEqual(live.map_pages("https://x.fr/p"), (["https://x.fr/p/a"], 5))
            replay = CachedCollectorIO(tmp, cache_only=True)
            self.assertEqual(replay.map_pages("https://x.fr/p"), (["https://x.fr/p/a"], 0))
            self.assertEqual(replay.calls["map"], {"cached": 1, "live": 0, "cached_credits": 5})

    def test_a_cache_miss_is_not_swallowed_as_an_extraction_failure(self):
        # run_extraction avale les erreurs d'extraction pour continuer : un
        # rejeu sur cache ne doit pas « reussir » sur une reponse absente.
        with tempfile.TemporaryDirectory() as tmp:
            pages = {"https://x.fr/p/a": "# Fiche"}
            live = CachedCollectorIO(tmp, inner=ScriptedIO(["https://x.fr/p/a"], pages, lambda u: {}))
            live.map_pages("https://x.fr/p")
            live.extract(["https://x.fr/p", "https://x.fr/p/a"])
            replay = CachedCollectorIO(tmp, cache_only=True)
            with self.assertRaises(CacheMiss):
                collect_campus_rows(
                    replay, school_name="X", domain="x.fr", campuses=["Paris"],
                    catalog_url="https://x.fr/p",
                )


# ── Les refus avant toute depense ─────────────────────────────────

def snapshot(**overrides):
    base = dict(
        school_id="school-1", name="Ecole", official_domain="ecole.fr",
        campuses=[{"id": "c1", "name": "Paris"}],
        programs=[{"id": "p1", "name": "Programme Grande École", "campus_policy_note": None}],
        edges=[], attachments=[],
    )
    base.update(overrides)
    return SchoolSnapshot(**base)


class TestNothingIsSpentWithoutProgramsCampusesOrCatalog(unittest.TestCase):
    def test_emlv_and_essec_have_no_program_so_nothing_is_called(self):
        emitted, emit = recorder()
        for name in ("EMLV", "Essec"):
            with self.subTest(name):
                out = run_campus_attachment_step(
                    snapshot(name=name, campuses=[], programs=[]),
                    ExplodingIO(), ["https://emlv.fr/formations"], emit,
                )
                self.assertEqual((out["status"], out["reason"], out["ticket_id"]), ("skipped", "no_program_in_db", None))
        self.assertEqual(emitted, [])

    def test_a_school_without_campus_is_skipped(self):
        out = run_campus_attachment_step(snapshot(campuses=[]), ExplodingIO(), ["https://ecole.fr/p"], recorder()[1])
        self.assertEqual((out["status"], out["reason"]), ("skipped", "no_campus_in_db"))

    def test_no_catalog_page_means_no_map(self):
        out = run_campus_attachment_step(snapshot(), ExplodingIO(), [], recorder()[1])
        self.assertEqual((out["status"], out["reason"]), ("skipped", "no_catalog_page"))


# ── EM Strasbourg, cas construit ──────────────────────────────────

STRASBOURG = SchoolSnapshot(
    school_id="5d574861-3c45-40e9-9d21-f87dd1856d8a",
    name="EM Strasbourg",
    official_domain="em-strasbourg.com/fr",
    campuses=[{"id": "c-pege", "name": "Pôle Européen de Gestion et d'Économie (PEGE)"}],
    programs=[
        {"id": f"p{i}", "name": name, "campus_policy_note": None}
        for i, name in enumerate([
            "Bachelor Affaires Internationales",
            "International and European Business Specialization",
            "M1+M2 E-Marketing et Stratégie Digitale",
            "Master of European Digital and Sustainable Business (EDSB)",
            "Master of European Management Studies",
            "Master of European Tourism, Wine, and Agrifood Management (ETWAM)",
            "Programme Grande École",
        ])
    ],
    edges=[{"id": f"e{i}", "programId": f"p{i}", "campusId": "c-pege"} for i in range(7)],
)
STRASBOURG_CATALOG = "https://www.em-strasbourg.com/fr/etudiant/formations"
STRASBOURG_FICHES = [
    "https://www.em-strasbourg.com/fr/etudiant/formations/programme-grande-ecole",
    "https://www.em-strasbourg.com/fr/etudiant/formations/bachelor-affaires-internationales",
]
STRASBOURG_ENCART = """# Programme Grande École

Conditions d'accès
Bac+2 validé

Diplôme obtenu
Diplôme visé Bac+5, grade de Master

Langues
Français, anglais

Rythme
Temps plein ou alternance

Durée
3 ans
"""


class TestEmStrasbourgPublishesNoPlace(unittest.TestCase):
    def pages(self):
        return {url: STRASBOURG_ENCART for url in [STRASBOURG_CATALOG, *STRASBOURG_FICHES]}

    def test_zero_line_no_ticket_no_error(self):
        emitted, emit = recorder()
        io = ScriptedIO(STRASBOURG_FICHES, self.pages(), lambda urls: {"statements": [], "policies": []})
        out = run_campus_attachment_step(STRASBOURG, io, [STRASBOURG_CATALOG], emit)

        self.assertEqual(out["status"], "no_rows")
        self.assertIsNone(out["ticket_id"])
        self.assertEqual(out["totals"]["program_campus_attachment"], 0)
        self.assertEqual(out["totals"]["program_campus"], 0)
        self.assertEqual(emitted, [])

    def test_even_an_invented_strasbourg_in_prose_writes_nothing(self):
        # Le nom du seul campus en base ne contient pas sa ville : un « Strasbourg »
        # de prose ne le reconnait pas, et part au mieux en ProgramPlacement, qui
        # n'a pas de chemin d'ecriture.
        def invented(urls):
            return {"statements": [{
                "program_name": "Programme Grande École", "zone": "PROSE", "study_year": 0,
                "regime": "ANY", "label": "Strasbourg", "languages": ["FR"],
                "verbatim": "au coeur de Strasbourg", "source_url": STRASBOURG_FICHES[0],
            }]}

        emitted, emit = recorder()
        io = ScriptedIO(STRASBOURG_FICHES, self.pages(), invented)
        out = run_campus_attachment_step(STRASBOURG, io, [STRASBOURG_CATALOG], emit)

        self.assertEqual(out["status"], "no_rows")
        self.assertEqual(out["totals"]["program_campus_attachment"], 0)
        self.assertEqual(emitted, [])


# ── La garde contre l'inondation ──────────────────────────────────

PGE_URL = "https://www.em-normandie.com/programmes/programme-grande-ecole/programme-grande-ecole-en-5-ans"
PGE_PAGE = """1. Accueil
2. Programme Grande École en 5 ans

# Programme Grande École en 5 ans

## Campus de rattachement

1re année : Caen — cours en français ou en anglais
"""
NORMANDIE = SchoolSnapshot(
    school_id="school-normandie", name="Em Normandie", official_domain="www.em-normandie.com",
    campuses=[{"id": "c-caen", "name": "Caen"}, {"id": "c-paris", "name": "Paris"}],
    programs=[{"id": "p-pge", "name": "Programme Grande École", "campus_policy_note": None}],
    edges=[{"id": "e-pge-caen", "programId": "p-pge", "campusId": "c-caen"}],
)


def pge_statements(urls):
    return {"statements": [{
        "program_name": "Programme Grande École en 5 ans", "zone": "SECTION", "study_year": 1,
        "regime": "ANY", "label": "Caen", "languages": ["FR", "EN"],
        "verbatim": "1re année : Caen", "source_url": PGE_URL,
    }]}


class TestOneTicketOnlyWhenThePlanWrites(unittest.TestCase):
    def io(self):
        return ScriptedIO([PGE_URL], {"https://www.em-normandie.com/programmes": "# Programmes", PGE_URL: PGE_PAGE}, pge_statements)

    def test_a_new_line_deposits_one_pending_ticket(self):
        emitted, emit = recorder()
        out = run_campus_attachment_step(NORMANDIE, self.io(), ["https://www.em-normandie.com/programmes"], emit)

        self.assertEqual((out["status"], out["ticket_id"]), ("ticket_emitted", "ticket-1"))
        self.assertEqual(out["plan"]["attachments"]["create"], 1)
        self.assertEqual(len(emitted), 1)
        claims = emitted[0]["payload"]["campus_attachments"]
        self.assertEqual(
            [(c["programId"], c["campusId"], c["study_year"], c["languages"]) for c in claims],
            [("p-pge", "c-caen", 1, ["EN", "FR"])],
        )
        self.assertEqual(emitted[0]["urls"], [PGE_URL])

    def test_the_same_line_already_in_db_deposits_nothing(self):
        written = SchoolSnapshot(**{**NORMANDIE.__dict__, "attachments": [{
            "id": "row-1", "programCampusId": "e-pge-caen", "study_year": 1, "regime": "ANY",
            "languages": ["EN", "FR"], "note": None, "source_url": PGE_URL,
        }]})
        emitted, emit = recorder()
        out = run_campus_attachment_step(written, self.io(), ["https://www.em-normandie.com/programmes"], emit)

        self.assertEqual((out["status"], out["ticket_id"]), ("no_change", None))
        self.assertEqual(out["plan"]["attachments"]["unchanged"], 1)
        self.assertEqual(emitted, [])

    def test_a_line_on_a_missing_edge_alone_deposits_nothing(self):
        no_edge = SchoolSnapshot(**{**NORMANDIE.__dict__, "edges": []})
        emitted, emit = recorder()
        out = run_campus_attachment_step(no_edge, self.io(), ["https://www.em-normandie.com/programmes"], emit)

        self.assertEqual(out["status"], "no_change")
        self.assertEqual(out["plan"]["conflicts"], {"edge_missing": 1})
        self.assertEqual(emitted, [])


# ── La base : lecture seule, et le depot du ticket ────────────────

class TestDatabaseEdges(unittest.TestCase):
    def test_the_snapshot_only_selects(self):
        cur = MagicMock()
        cur.fetchone.return_value = {"id": "s1", "name": "Em Lyon", "official_domain": "em-lyon.com"}
        cur.fetchall.side_effect = [
            [{"id": "c1", "name": "Lyon campus"}],
            [{"id": "p1", "name": "Global BBA", "campus_policy_note": None}],
            [{"id": "e1", "programId": "p1", "campusId": "c1"}],
            [],
        ]
        snap = read_school_snapshot(cur, "s1")

        self.assertEqual(snap.campus_names, ["Lyon campus"])
        self.assertEqual(snap.edges[0]["id"], "e1")
        statements = [call.args[0].strip().split()[0].upper() for call in cur.execute.call_args_list]
        self.assertEqual(statements, ["SELECT"] * 5)

    def test_the_ticket_is_a_pending_program_discovery_carrying_the_block(self):
        cur = MagicMock()
        conn = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur
        ticket_id = insert_attachment_ticket(conn, "s1", {"campus_attachments": [], "campus_policy_notes": []}, ["https://x"])

        sql, params = cur.execute.call_args.args
        self.assertIn('INSERT INTO "ContributionInbox"', sql)
        self.assertEqual(params[0], ticket_id)
        self.assertEqual(params[1:4], ("Automated_AI", "s1", "Program_Discovery"))
        self.assertEqual(json.loads(params[4]), {"campus_attachments": [], "campus_policy_notes": []})
        self.assertEqual(params[5], "Pending_Admin")

    def test_a_dump_gives_the_same_snapshot_shape(self):
        dump = [{"id": "s1", "name": "Em Lyon", "official_domain": "em-lyon.com",
                 "campuses": [{"id": "c1", "name": "Lyon campus", "city": "Lyon"}],
                 "programs": [{"id": "p1", "name": "Global BBA"}],
                 "edges": [{"id": "e1", "programId": "p1", "campusId": "c1"}]}]
        snap = snapshot_from_dump(dump, "Em Lyon")
        self.assertEqual(snap.campuses, [{"id": "c1", "name": "Lyon campus"}])
        self.assertEqual(snap.programs, [{"id": "p1", "name": "Global BBA", "campus_policy_note": None}])
        self.assertEqual(snap.attachments, [])
        with self.assertRaises(KeyError):
            snapshot_from_dump(dump, "Essec")


# ── Le branchement dans la Phase 1 ────────────────────────────────

class TestPhase1Wiring(unittest.TestCase):
    def run_phase1(self, discovery_result, context_fill, dry_run=False, step_result=None, collect=True):
        from backend.pipeline import phase1_research

        def fake_discovery(school_id, key_manager, dry_run_, progress_callback, context):
            context.update(context_fill)
            return dict(discovery_result)

        step = MagicMock(return_value=step_result or {"status": "no_change", "ticket_id": None})
        with patch.object(phase1_research, "_run_program_discovery", side_effect=fake_discovery), \
             patch.object(phase1_research, "_run_campus_attachment_step", step):
            if collect is None:
                result = phase1_research.run_phase1_research("s1", "key-manager", dry_run=dry_run)
            else:
                result = phase1_research.run_phase1_research(
                    "s1", "key-manager", dry_run=dry_run, collect_campus_attachments=collect
                )
        return result, step

    def test_the_step_runs_after_a_successful_discovery(self):
        result, step = self.run_phase1(
            {"success": True, "inbox_id": "discovery-ticket"},
            {"school": {"name": "Em Normandie"}, "catalog_urls": ["https://www.em-normandie.com/programmes"]},
        )
        step.assert_called_once()
        self.assertEqual(step.call_args.args[2]["catalog_urls"], ["https://www.em-normandie.com/programmes"])
        self.assertEqual(result["inbox_id"], "discovery-ticket")
        self.assertEqual(result["campus_attachments"]["status"], "no_change")

    def test_the_step_still_runs_when_discovery_failed(self):
        result, step = self.run_phase1(
            {"success": False, "message": "Aucun campus avec au moins une formation valide"},
            {"school": {"name": "Em Normandie"}},
        )
        step.assert_called_once()
        self.assertFalse(result["success"])

    def test_never_in_dry_run_and_never_for_an_unread_school(self):
        _, step = self.run_phase1({"success": True}, {"school": {"name": "X"}}, dry_run=True)
        step.assert_not_called()
        _, step = self.run_phase1({"success": False, "message": "École non trouvée"}, {})
        step.assert_not_called()

    def test_off_by_default_and_said_in_the_result(self):
        discovery = {"success": True, "inbox_id": "discovery-ticket"}
        school = {"school": {"name": "Em Lyon"}, "catalog_urls": ["https://em-lyon.com/fr/nos-programmes"]}
        for collect in (None, False):
            with self.subTest(collect=collect):
                result, step = self.run_phase1(discovery, school, collect=collect)
                step.assert_not_called()
                self.assertEqual(result["campus_attachments"], {"status": "disabled"})
                # La découverte rend son résultat intact.
                self.assertEqual((result["success"], result["inbox_id"]), (True, "discovery-ticket"))

    def test_off_even_when_discovery_failed(self):
        result, step = self.run_phase1(
            {"success": False, "message": "Erreur Tavily Research: timeout"},
            {"school": {"name": "Em Normandie"}},
            collect=False,
        )
        step.assert_not_called()
        self.assertEqual(result["campus_attachments"], {"status": "disabled"})
        self.assertFalse(result["success"])

    def test_off_emits_no_paid_call(self):
        """Désactivée, la collecte ne touche ni la base, ni Tavily, ni Gemini."""
        from backend.pipeline import phase1_research
        import backend.db
        import backend.pipeline.campus_attachment_collector as collector

        def fake_discovery(school_id, key_manager, dry_run_, progress_callback, context):
            context.update({"school": {"name": "Em Normandie"}, "catalog_urls": ["https://www.em-normandie.com/programmes"]})
            return {"success": True}

        exploding = MagicMock(side_effect=AssertionError("appel inattendu : la collecte est désactivée"))
        with patch.object(phase1_research, "_run_program_discovery", side_effect=fake_discovery), \
             patch.object(backend.db, "get_db_connection", exploding), \
             patch.object(collector, "LiveCollectorIO", exploding), \
             patch.object(collector, "read_school_snapshot", exploding), \
             patch.object(collector, "run_campus_attachment_step", exploding), \
             patch.object(collector, "insert_attachment_ticket", exploding):
            result = phase1_research.run_phase1_research("s1", ExplodingIO())
        exploding.assert_not_called()
        self.assertEqual(result["campus_attachments"], {"status": "disabled"})

    def test_on_runs_the_real_step_exactly_as_before(self):
        """Activée, le pas réel est appelé avec les mêmes arguments qu'avant l'interrupteur."""
        from backend.pipeline import phase1_research
        import backend.db
        import backend.pipeline.campus_attachment_collector as collector

        @contextmanager
        def fake_connection():
            yield MagicMock(name="conn")

        def fake_discovery(school_id, key_manager, dry_run_, progress_callback, context):
            context.update({"school": {"name": "Em Normandie"}, "catalog_urls": ["https://www.em-normandie.com/programmes"]})
            return {"success": True}

        step = MagicMock(return_value={"status": "ticket_emitted", "ticket_id": "t1", "school": "Em Normandie"})
        with patch.object(phase1_research, "_run_program_discovery", side_effect=fake_discovery), \
             patch.object(backend.db, "get_db_connection", fake_connection), \
             patch.object(collector, "read_school_snapshot", return_value=snapshot()), \
             patch.object(collector, "run_campus_attachment_step", step):
            result = phase1_research.run_phase1_research("s1", "key-manager", collect_campus_attachments=True)
        step.assert_called_once()
        snap, io, index_pages, emit = step.call_args.args
        self.assertIsInstance(io, collector.LiveCollectorIO)
        self.assertEqual(index_pages, ["https://www.em-normandie.com/programmes"])
        self.assertEqual(result["campus_attachments"]["status"], "ticket_emitted")

    def test_the_step_never_raises_into_phase1(self):
        from backend.pipeline import phase1_research
        import backend.db
        import backend.pipeline.campus_attachment_collector as collector

        @contextmanager
        def fake_connection():
            conn = MagicMock()
            yield conn

        with patch.object(backend.db, "get_db_connection", fake_connection), \
             patch.object(collector, "read_school_snapshot", return_value=snapshot()), \
             patch.object(collector, "run_campus_attachment_step", side_effect=RuntimeError("quota Tavily épuisé")):
            out = phase1_research._run_campus_attachment_step(
                "s1", "key-manager", {"school": {"name": "Ecole"}, "catalog_urls": ["https://ecole.fr/p"]}, None
            )
        self.assertEqual(out["status"], "failed")
        self.assertIn("quota", out["error"])

    def test_the_emitter_inserts_through_the_collector(self):
        from backend.pipeline import phase1_research
        import backend.db
        import backend.pipeline.campus_attachment_collector as collector

        @contextmanager
        def fake_connection():
            yield MagicMock(name="conn")

        def fake_step(snap, io, index_pages, emit, progress=None):
            return {"status": "ticket_emitted", "ticket_id": emit({"campus_attachments": []}, ["https://x"]), "index": index_pages}

        insert = MagicMock(return_value="new-ticket")
        with patch.object(backend.db, "get_db_connection", fake_connection), \
             patch.object(collector, "read_school_snapshot", return_value=snapshot()), \
             patch.object(collector, "run_campus_attachment_step", side_effect=fake_step), \
             patch.object(collector, "insert_attachment_ticket", insert):
            out = phase1_research._run_campus_attachment_step(
                "s1", "key-manager", {"school": {"name": "Ecole"}, "catalog_urls": ["https://ecole.fr/p"]}, None
            )
        self.assertEqual((out["status"], out["ticket_id"], out["index"]), ("ticket_emitted", "new-ticket", ["https://ecole.fr/p"]))
        self.assertEqual(insert.call_args.args[1:], ("s1", {"campus_attachments": []}, ["https://x"]))


if __name__ == "__main__":
    unittest.main()
