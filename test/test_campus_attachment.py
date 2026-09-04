"""
Les trois regles de la collecte campus <-> programme, sur les cas reels.

Les fixtures ne sont pas inventees : chaque enonce reprend une ligne
effectivement publiee par EM Normandie ou Em Lyon, telle que l'inventaire des
16 formes l'a relevee. Un test qui passerait sur des donnees plausibles mais
fausses ne prouverait rien de la regle.
"""

import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.pipeline.campus_attachment import (  # noqa: E402
    KIND_PARTNER,
    KIND_REGION,
    KIND_REMOTE,
    KIND_UNSPECIFIED,
    _href_is_usable,
    absorb_any_regime,
    build_page_evidence,
    build_rows,
    classify_kind,
    fold_label,
    has_attachment_heading,
    match_campus,
    parse_statements,
    pick_spelling,
    published_years,
    split_multi_campus_label,
)
from backend.tavily_service.client import (  # noqa: E402
    is_rooted_on_page,
    map_program_pages,
    record_reported_usage,
)
from backend.scripts.simulate_campus_attachment import (  # noqa: E402
    _is_worth_caching,
    looks_like_program_page,
)

EM_NORMANDIE_CAMPUSES = ["Caen", "Le Havre", "Paris", "Dublin", "Oxford", "Dubai"]
EM_LYON_CAMPUSES = ["Lyon", "Paris", "Saint-Etienne", "Shanghai", "Mumbai"]


def stmt(program, zone, year, regime, label, languages=None, verbatim=None, url=None):
    return {
        "program_name": program,
        "zone": zone,
        "study_year": year,
        "regime": regime,
        "label": label,
        "languages": languages or [],
        "verbatim": verbatim,
        "source_url": url,
    }


def program_of(rows, name):
    for entry in rows["programs"]:
        if entry["program"] == name:
            return entry
    raise AssertionError(f"programme absent de la sortie : {name}")


# ── Regle 3 · normalisation de label ──────────────────────────────

class TestLabelNormalisation(unittest.TestCase):
    def test_accents_and_case_fold_to_one_key(self):
        self.assertEqual(
            fold_label("Université partenaire"), fold_label("Universite partenaire")
        )
        self.assertEqual(fold_label("LE HAVRE"), fold_label("Le Havre"))
        self.assertEqual(fold_label("Dubaï"), fold_label("Dubai"))

    def test_edge_punctuation_and_inner_spaces(self):
        self.assertEqual(fold_label("  Le  Havre , "), "le havre")
        # Les parentheses internes portent du sens : « Quebec (Region) » n'est
        # pas « Quebec ».
        self.assertEqual(fold_label("Québec (Région)"), "quebec (region)")
        self.assertNotEqual(fold_label("Quebec (Region)"), fold_label("Quebec"))

    def test_distinct_places_do_not_collide(self):
        """Le repli ne doit jamais fusionner deux lieux differents."""
        labels = [
            "Lyon", "Paris", "Le Havre", "Caen", "Dublin", "Oxford", "Dubaï",
            "Shanghai", "Milan", "Londres", "New York", "Rome", "Perth",
            "International", "Europe", "Online", "UniLaSalle Rouen",
            "Institut Lyfe", "Université partenaire", "Québec (Région)",
            "Finlande", "Vietnam", "Afrique du Sud", "Chypre", "Ecole Centrale",
        ]
        folds = [fold_label(label) for label in labels]
        self.assertEqual(len(set(folds)), len(labels))

    def test_kept_spelling_is_the_most_accented_and_deterministic(self):
        spellings = ["Universite partenaire", "Université partenaire"]
        self.assertEqual(pick_spelling(spellings), "Université partenaire")
        self.assertEqual(pick_spelling(list(reversed(spellings))), "Université partenaire")

    def test_two_spellings_produce_one_placement_row(self):
        raw = {
            "statements": [
                stmt("BM3", "SECTION", 3, "INITIAL", "Universite partenaire"),
                stmt("BM3", "SECTION", 3, "INITIAL", "Université partenaire"),
            ]
        }
        rows = build_rows(raw, EM_NORMANDIE_CAMPUSES)
        placements = program_of(rows, "BM3")["program_placement"]
        self.assertEqual(len(placements), 1)
        self.assertEqual(placements[0]["label"], "Université partenaire")
        self.assertEqual(
            program_of(rows, "BM3")["spelling_merges"][0]["kept"],
            "Université partenaire",
        )

    def test_campus_matching_uses_the_same_fold(self):
        """« DUBAI » sur la fiche doit reconnaitre le campus « Dubai »."""
        raw = {"statements": [stmt("MSc X", "FIELD", 0, "ANY", "DUBAÏ")]}
        rows = build_rows(raw, EM_NORMANDIE_CAMPUSES)
        entry = program_of(rows, "MSc X")
        self.assertEqual([r["campusName"] for r in entry["program_campus"]], ["Dubai"])
        self.assertEqual(entry["program_placement"], [])


# ── kind, decide avec la liste de campus passee en parametre ──────

class TestKindClassification(unittest.TestCase):
    def setUp(self):
        self.folds = frozenset(fold_label(c) for c in EM_LYON_CAMPUSES)

    def test_remote_region_partner_and_drawer(self):
        self.assertEqual(classify_kind("Online", self.folds), KIND_REMOTE)
        self.assertEqual(classify_kind("Blended learning E-learning", self.folds), KIND_REMOTE)
        self.assertEqual(classify_kind("International", self.folds), KIND_REGION)
        self.assertEqual(classify_kind("Québec (Région)", self.folds), KIND_REGION)
        self.assertEqual(classify_kind("Finlande", self.folds), KIND_REGION)
        self.assertEqual(classify_kind("Université partenaire", self.folds), KIND_PARTNER)
        self.assertEqual(classify_kind("UniLaSalle Rouen", self.folds), KIND_PARTNER)
        self.assertEqual(classify_kind("Institut Lyfe", self.folds), KIND_PARTNER)
        self.assertEqual(classify_kind("Milan", self.folds), KIND_PARTNER)
        self.assertEqual(
            classify_kind("Paris et New York ou Londres ou Rome et International", self.folds),
            KIND_UNSPECIFIED,
        )

    def test_shanghai_is_a_campus_of_em_lyon_and_not_a_placement(self):
        raw = {"statements": [stmt("MSc Y", "FIELD", 0, "ANY", "Shanghai")]}
        rows = build_rows(raw, EM_LYON_CAMPUSES)
        entry = program_of(rows, "MSc Y")
        self.assertEqual([r["campusName"] for r in entry["program_campus"]], ["Shanghai"])
        self.assertEqual(entry["program_placement"], [])

    def test_same_label_is_a_placement_for_a_school_without_that_campus(self):
        raw = {"statements": [stmt("MSc Y", "FIELD", 0, "ANY", "Shanghai")]}
        rows = build_rows(raw, EM_NORMANDIE_CAMPUSES)
        entry = program_of(rows, "MSc Y")
        self.assertEqual(entry["program_campus"], [])
        self.assertEqual(entry["program_placement"][0]["kind"], KIND_PARTNER)


class TestCampusMatching(unittest.TestCase):
    """
    Le repli des accents ne suffit pas : la premiere cause d'erreur mesuree est
    le qualificatif colle au lieu. « campus de Shanghai » designe le campus
    Shanghai d'Em Lyon ; replie tel quel il ne le reconnait pas et tombe en
    ProgramPlacement, ou il duplique une arete existante.
    """

    def setUp(self):
        self.folds = {fold_label(c): c for c in EM_LYON_CAMPUSES}

    def test_exact_fold_still_matches(self):
        self.assertEqual(match_campus("LYON", self.folds), "Lyon")
        self.assertEqual(match_campus("  Paris ", self.folds), "Paris")

    def test_campus_prefix_is_reduced(self):
        for label in ("campus de Shanghai", "Le campus de Lyon", "campus Paris"):
            self.assertEqual(
                match_campus(label, self.folds),
                {"campus de Shanghai": "Shanghai"}.get(label, "Lyon" if "Lyon" in label else "Paris"),
                label,
            )

    def test_trailing_qualifier_is_dropped(self):
        self.assertEqual(match_campus("Lyon, France", self.folds), "Lyon")
        self.assertEqual(
            match_campus("Lyon, avec une expérience internationale", self.folds), "Lyon"
        )

    def test_reduction_never_invents_a_match(self):
        for label in ("Londres", "Milan", "International", "Ecole Centrale",
                      "campus Institut Lyfe avec une expérience internationale",
                      "Online", "UniLaSalle Rouen"):
            self.assertIsNone(match_campus(label, self.folds), label)

    def test_the_adjectival_form_is_a_named_miss(self):
        """« campus parisien » designe Paris ; aucune reduction ne le dira."""
        self.assertIsNone(match_campus("campus parisien", self.folds))

    def test_a_qualified_label_becomes_the_campus_edge_not_a_placement(self):
        raw = {"statements": [stmt("MSc Health", "PROSE", 0, "ANY", "campus de Shanghai")]}
        entry = program_of(build_rows(raw, EM_LYON_CAMPUSES), "MSc Health")
        self.assertEqual([r["campusName"] for r in entry["program_campus"]], ["Shanghai"])
        self.assertEqual(entry["program_placement"], [])

# ── Regle 1 · F8, l'encart contre la section ──────────────────────

class TestF8Arbitration(unittest.TestCase):
    """
    PGE en 2 ou 3 ans, tel qu'il est publie :
      encart  : Caen, Le Havre, Paris, Dublin, Oxford
      section : Caen ou Paris / Dubai, Dublin ou Oxford
    Le Havre est dans l'encart et nulle part dans la section ; Dubai est dans
    la section et pas dans l'encart.
    """

    def setUp(self):
        prog = "Programme Grande Ecole en 2 ou 3 ans"
        field = [stmt(prog, "FIELD", 0, "ANY", c)
                 for c in ("Caen", "Le Havre", "Paris", "Dublin", "Oxford")]
        section = [
            stmt(prog, "SECTION", 1, "ANY", "Caen"),
            stmt(prog, "SECTION", 1, "ANY", "Paris"),
            stmt(prog, "SECTION", 2, "ANY", "Dubai", ["EN"]),
            stmt(prog, "SECTION", 2, "ANY", "Dublin", ["EN"]),
            stmt(prog, "SECTION", 2, "ANY", "Oxford", ["EN"]),
        ]
        self.prog = prog
        self.rows = build_rows({"statements": field + section}, EM_NORMANDIE_CAMPUSES)
        self.entry = program_of(self.rows, prog)

    def test_program_campus_is_the_union_of_both_zones(self):
        names = sorted(r["campusName"] for r in self.entry["program_campus"])
        self.assertEqual(names, ["Caen", "Dubai", "Dublin", "Le Havre", "Oxford", "Paris"])

    def test_le_havre_keeps_its_edge_and_gets_no_year_row(self):
        self.assertIn("Le Havre", [r["campusName"] for r in self.entry["program_campus"]])
        self.assertEqual(
            [r for r in self.entry["program_campus_attachment"] if r["campusName"] == "Le Havre"],
            [],
        )
        conflicts = [c for c in self.entry["conflicts"] if c["type"] == "field_only"]
        self.assertEqual([c["campus"] for c in conflicts], ["Le Havre"])

    def test_dubai_gets_both_the_edge_and_its_year_rows(self):
        self.assertIn("Dubai", [r["campusName"] for r in self.entry["program_campus"]])
        dubai = [r for r in self.entry["program_campus_attachment"] if r["campusName"] == "Dubai"]
        self.assertEqual([(r["study_year"], r["regime"]) for r in dubai], [(2, "ANY")])
        conflicts = [c for c in self.entry["conflicts"] if c["type"] == "section_only"]
        self.assertEqual([c["campus"] for c in conflicts], ["Dubai"])

    def test_the_field_never_creates_a_year_row(self):
        self.assertTrue(
            all(r["study_year"] >= 1 for r in self.entry["program_campus_attachment"])
        )
        self.assertEqual(len(self.entry["program_campus_attachment"]), 5)


class TestMonoCampusProducesNoChildRow(unittest.TestCase):
    """
    Le cas qui decide, selon l'etude : zero ligne fille = le sens actuel,
    inchange.
    """

    def test_single_campus_field_only(self):
        raw = {
            "statements": [
                stmt("MSc Supply Chain Management - Purchasing", "FIELD", 0, "ANY", "Le Havre"),
                stmt("MSc Supply Chain Management - Purchasing", "INDEX_CARD", 0, "ANY", "Le Havre"),
            ]
        }
        rows = build_rows(raw, EM_NORMANDIE_CAMPUSES)
        entry = program_of(rows, "MSc Supply Chain Management - Purchasing")
        self.assertEqual([r["campusName"] for r in entry["program_campus"]], ["Le Havre"])
        self.assertEqual(entry["program_campus_attachment"], [])
        self.assertEqual(entry["program_placement"], [])
        self.assertEqual(entry["conflicts"], [])

    def test_multi_campus_choice_without_a_section_stays_childless(self):
        """F2 : « Caen Le Havre Paris » sans decoupage par annee."""
        raw = {
            "statements": [
                stmt("Bachelor Management International - alternance", "FIELD", 0, "ANY", c)
                for c in ("Caen", "Le Havre", "Paris")
            ]
        }
        rows = build_rows(raw, EM_NORMANDIE_CAMPUSES)
        entry = program_of(rows, "Bachelor Management International - alternance")
        self.assertEqual(len(entry["program_campus"]), 3)
        self.assertEqual(entry["program_campus_attachment"], [])


# ── Regle 2 · ANY face a INITIAL / ALTERNANCE ─────────────────────

class TestRegimeAbsorption(unittest.TestCase):
    def test_any_is_absorbed_and_its_languages_are_poured_in(self):
        rows = [
            {"programCampusId": "pc", "study_year": 3, "regime": "ANY", "languages": ["FR"]},
            {"programCampusId": "pc", "study_year": 3, "regime": "INITIAL", "languages": ["EN"]},
        ]
        kept = absorb_any_regime(rows, ("programCampusId", "study_year"))
        self.assertEqual([r["regime"] for r in kept], ["INITIAL"])
        self.assertEqual(kept[0]["languages"], ["EN", "FR"])
        self.assertTrue(kept[0]["_absorbed_any"])

    def test_two_named_regimes_coexist(self):
        rows = [
            {"programCampusId": "pc", "study_year": 3, "regime": "INITIAL", "languages": []},
            {"programCampusId": "pc", "study_year": 3, "regime": "ALTERNANCE", "languages": []},
        ]
        kept = absorb_any_regime(rows, ("programCampusId", "study_year"))
        self.assertEqual(sorted(r["regime"] for r in kept), ["ALTERNANCE", "INITIAL"])
        self.assertFalse(any(r.get("_absorbed_any") for r in kept))

    def test_any_alone_survives(self):
        rows = [{"programCampusId": "pc", "study_year": 1, "regime": "ANY", "languages": ["FR"]}]
        kept = absorb_any_regime(rows, ("programCampusId", "study_year"))
        self.assertEqual([r["regime"] for r in kept], ["ANY"])

    def test_different_years_are_independent(self):
        rows = [
            {"programCampusId": "pc", "study_year": 1, "regime": "ANY", "languages": []},
            {"programCampusId": "pc", "study_year": 3, "regime": "INITIAL", "languages": []},
        ]
        kept = absorb_any_regime(rows, ("programCampusId", "study_year"))
        self.assertEqual(sorted((r["study_year"], r["regime"]) for r in kept),
                         [(1, "ANY"), (3, "INITIAL")])

    def test_contradiction_is_reported_on_a_real_fiche(self):
        prog = "Bachelor en Management en 3 ans"
        raw = {
            "statements": [
                stmt(prog, "SECTION", 3, "ANY", "Le Havre", ["FR"]),
                stmt(prog, "SECTION", 3, "INITIAL", "Le Havre", ["EN"]),
                stmt(prog, "SECTION", 3, "ALTERNANCE", "Le Havre", ["FR"]),
            ]
        }
        entry = program_of(build_rows(raw, EM_NORMANDIE_CAMPUSES), prog)
        regimes = sorted(r["regime"] for r in entry["program_campus_attachment"])
        self.assertEqual(regimes, ["ALTERNANCE", "INITIAL"])
        self.assertTrue(any(c["type"] == "regime_absorbed" for c in entry["conflicts"]))


class TestBachelorEnTroisAns(unittest.TestCase):
    """
    Le cas le plus courant du catalogue, verbatim :

      1re annee   Le Havre (anglais ou francais) . Paris (francais)
      2e annee    Le Havre (anglais ou francais) . Paris (francais) . Dublin (anglais)
      3e annee    INITIAL     Le Havre (francais ou anglais) . Universite partenaire
                  ALTERNANCE  Caen . Le Havre ou Paris (francais)
      encart      Caen Le Havre Paris Dublin
    """

    def setUp(self):
        prog = "Bachelor en Management en 3 ans"
        self.prog = prog
        statements = [
            stmt(prog, "FIELD", 0, "ANY", c) for c in ("Caen", "Le Havre", "Paris", "Dublin")
        ] + [
            stmt(prog, "SECTION", 1, "ANY", "Le Havre", ["EN", "FR"]),
            stmt(prog, "SECTION", 1, "ANY", "Paris", ["FR"]),
            stmt(prog, "SECTION", 2, "ANY", "Le Havre", ["EN", "FR"]),
            stmt(prog, "SECTION", 2, "ANY", "Paris", ["FR"]),
            stmt(prog, "SECTION", 2, "ANY", "Dublin", ["EN"]),
            stmt(prog, "SECTION", 3, "INITIAL", "Le Havre", ["FR", "EN"]),
            stmt(prog, "SECTION", 3, "INITIAL", "Universite partenaire", [],
                 "Universite partenaire - Double-diplome"),
            stmt(prog, "SECTION", 3, "ALTERNANCE", "Caen", ["FR"]),
            stmt(prog, "SECTION", 3, "ALTERNANCE", "Le Havre", ["FR"]),
            stmt(prog, "SECTION", 3, "ALTERNANCE", "Paris", ["FR"]),
        ]
        self.entry = program_of(
            build_rows({"statements": statements}, EM_NORMANDIE_CAMPUSES), prog
        )

    def test_nine_attachment_rows_exactly_as_the_study_encoded_them(self):
        got = sorted(
            (r["campusName"], r["study_year"], r["regime"])
            for r in self.entry["program_campus_attachment"]
        )
        self.assertEqual(got, [
            ("Caen", 3, "ALTERNANCE"),
            ("Dublin", 2, "ANY"),
            ("Le Havre", 1, "ANY"),
            ("Le Havre", 2, "ANY"),
            ("Le Havre", 3, "ALTERNANCE"),
            ("Le Havre", 3, "INITIAL"),
            ("Paris", 1, "ANY"),
            ("Paris", 2, "ANY"),
            ("Paris", 3, "ALTERNANCE"),
        ])

    def test_no_false_statement_is_produced(self):
        """Paris n'a pas de ligne (3, INITIAL) : le modele ne la pretend pas."""
        self.assertNotIn(
            ("Paris", 3, "INITIAL"),
            [(r["campusName"], r["study_year"], r["regime"])
             for r in self.entry["program_campus_attachment"]],
        )

    def test_universite_partenaire_lands_in_placement_not_in_campus(self):
        self.assertEqual(
            [(r["label"], r["study_year"], r["regime"], r["kind"])
             for r in self.entry["program_placement"]],
            [("Universite partenaire", 3, "INITIAL", KIND_PARTNER)],
        )
        self.assertNotIn(
            "Universite partenaire",
            [r["campusName"] for r in self.entry["program_campus"]],
        )

    def test_languages_stay_attached_to_the_year_campus_pair(self):
        by_key = {
            (r["campusName"], r["study_year"], r["regime"]): r["languages"]
            for r in self.entry["program_campus_attachment"]
        }
        self.assertEqual(by_key[("Le Havre", 1, "ANY")], ["EN", "FR"])
        self.assertEqual(by_key[("Paris", 1, "ANY")], ["FR"])
        self.assertEqual(by_key[("Le Havre", 3, "ALTERNANCE")], ["FR"])


class TestPolicyNoteAndUnplacedYear(unittest.TestCase):
    def test_ibba_policy_is_carried_and_the_itinerary_is_written(self):
        raw = {
            "statements": [
                stmt("IBBA", "SECTION", 1, "ANY", "Paris", ["EN"]),
                stmt("IBBA", "SECTION", 2, "ANY", "Dublin", ["EN"]),
                stmt("IBBA", "SECTION", 3, "ANY", "Dubai", ["EN"]),
                stmt("IBBA", "SECTION", 4, "ANY", "Oxford", ["EN"]),
            ],
            "policies": [{
                "program_name": "IBBA",
                "policy_note": (
                    "Paris reste accessible chaque annee, avec au moins une annee "
                    "obligatoire sur l'un des campus internationaux."
                ),
            }],
        }
        entry = program_of(build_rows(raw, EM_NORMANDIE_CAMPUSES), "IBBA")
        self.assertEqual(len(entry["program_campus_attachment"]), 4)
        self.assertIn("Paris reste accessible", entry["campus_policy_note"])

    def test_a_named_year_without_a_place_makes_no_row_but_is_traced(self):
        """F9 : « 4e et 5e annees — en fonction de l'orientation choisie »."""
        raw = {
            "statements": [
                stmt("PGE en 5 ans", "SECTION", 4, "ANY", None, [],
                     "4e et 5e annees - en fonction de l'orientation choisie"),
                stmt("PGE en 5 ans", "SECTION", 5, "ANY", None, [],
                     "4e et 5e annees - en fonction de l'orientation choisie"),
            ]
        }
        entry = program_of(build_rows(raw, EM_NORMANDIE_CAMPUSES), "PGE en 5 ans")
        self.assertEqual(entry["program_campus_attachment"], [])
        self.assertEqual(
            sorted(c["study_year"] for c in entry["conflicts"]
                   if c["type"] == "year_without_place"),
            [4, 5],
        )


class TestStatementValidation(unittest.TestCase):
    def test_malformed_statements_are_rejected_and_counted(self):
        raw = {
            "statements": [
                stmt("A", "ENCART", 0, "ANY", "Lyon"),
                stmt("A", "FIELD", 0, "PARTIEL", "Lyon"),
                stmt("", "FIELD", 0, "ANY", "Lyon"),
                stmt("A", "FIELD", 2, "ANY", "Lyon"),
                stmt("A", "FIELD", 0, "ANY", None),
                stmt("A", "SECTION", -1, "ANY", "Lyon"),
                stmt("A", "FIELD", 0, "ANY", "Lyon"),
            ]
        }
        kept, rejected = parse_statements(raw)
        self.assertEqual(len(kept), 1)
        self.assertEqual(
            sorted(r["reason"] for r in rejected),
            [
                "bad_study_year",
                "missing_program_name",
                "null_label_without_year",
                "unknown_regime:PARTIEL",
                "unknown_zone:ENCART",
                "year_on_field_zone",
            ],
        )

    def test_totals_expose_the_rejection_count(self):
        rows = build_rows({"statements": [stmt("A", "NOPE", 0, "ANY", "Lyon")]}, ["Lyon"])
        self.assertEqual(rows["totals"]["statements_rejected"], 1)
        self.assertEqual(rows["totals"]["statements_kept"], 0)


# ── Le wrapper /map ───────────────────────────────────────────────

class TestMapWrapper(unittest.TestCase):
    def setUp(self):
        self.key_manager = MagicMock()
        self.key_manager.get_active_key.return_value = "tvly-key-abcdef"

    def test_domain_root_is_refused_without_spending_a_credit(self):
        for root in ("https://www.em-normandie.com", "https://em-lyon.com/", "em-lyon.com"):
            urls, credits = map_program_pages(root, self.key_manager)
            self.assertEqual((urls, credits), ([], 0))
        self.key_manager.get_active_key.assert_not_called()

    def test_is_rooted_on_page(self):
        self.assertFalse(is_rooted_on_page("https://www.em-normandie.com"))
        self.assertFalse(is_rooted_on_page("https://www.em-normandie.com/"))
        self.assertTrue(is_rooted_on_page("https://www.em-normandie.com/programmes"))
        self.assertTrue(is_rooted_on_page("em-lyon.com/fr/programmes"))

    def test_catalog_page_is_mapped_and_real_usage_is_recorded(self):
        response = {
            "results": ["https://x.fr/programmes/b", "https://x.fr/programmes/a",
                        "https://x.fr/programmes/a"],
            "usage": {"credits": 7},
        }
        with patch("tavily.TavilyClient") as client_cls:
            client_cls.return_value.map.return_value = response
            urls, credits = map_program_pages(
                "https://x.fr/programmes", self.key_manager, instructions="find"
            )
        self.assertEqual(urls, ["https://x.fr/programmes/a", "https://x.fr/programmes/b"])
        self.assertEqual(credits, 7)
        self.key_manager.record_usage.assert_called_once_with("tvly-key-abcdef", credits=7)
        kwargs = client_cls.return_value.map.call_args.kwargs
        self.assertEqual(kwargs["url"], "https://x.fr/programmes")
        self.assertEqual(kwargs["instructions"], "find")
        self.assertTrue(kwargs["include_usage"])
        self.assertIn("timeout", kwargs)

    def test_a_quota_refusal_moves_to_the_next_key(self):
        """
        Mesure du 4 septembre : le compteur local d'une cle annoncait 48
        credits quand l'API refusait deja l'appel. /map est l'etape de
        decouverte — abandonner sur la premiere cle vide toute la passe.
        """
        self.key_manager.get_active_key.side_effect = ["k-usee", "k-saine"]
        response = {"results": ["https://x.fr/programmes/a"], "usage": {"credits": 5}}
        with patch("tavily.TavilyClient") as client_cls:
            client_cls.return_value.map.side_effect = [
                Exception("This request exceeds your plan's set usage limit"),
                response,
            ]
            urls, credits = map_program_pages("https://x.fr/programmes", self.key_manager)
        self.assertEqual(urls, ["https://x.fr/programmes/a"])
        self.assertEqual(credits, 5)
        self.key_manager.mark_exhausted.assert_called_once_with("k-usee")
        self.key_manager.record_usage.assert_called_once_with("k-saine", credits=5)

    def test_every_key_refused_gives_up_without_raising(self):
        self.key_manager.get_active_key.return_value = "k"
        with patch("tavily.TavilyClient") as client_cls:
            client_cls.return_value.map.side_effect = Exception(
                "This request exceeds your plan's set usage limit"
            )
            urls, credits = map_program_pages("https://x.fr/programmes", self.key_manager)
        self.assertEqual((urls, credits), ([], 0))
        self.assertEqual(self.key_manager.mark_exhausted.call_count, 3)

    def test_quota_error_marks_the_key_and_returns_empty(self):
        with patch("tavily.TavilyClient") as client_cls:
            # Phrase reelle de la liste de key_manager.QUOTA_ERROR_PHRASES :
            # la detection est lexicale, pas fondee sur le code HTTP.
            client_cls.return_value.map.side_effect = Exception(
                "Your request exceeds your plan usage limit"
            )
            urls, credits = map_program_pages("https://x.fr/programmes", self.key_manager)
        self.assertEqual((urls, credits), ([], 0))
        self.key_manager.mark_exhausted.assert_called_with("tvly-key-abcdef")

    def test_other_errors_do_not_mark_the_key(self):
        with patch("tavily.TavilyClient") as client_cls:
            client_cls.return_value.map.side_effect = Exception("connection timed out")
            urls, credits = map_program_pages("https://x.fr/programmes", self.key_manager)
        self.assertEqual((urls, credits), ([], 0))
        self.key_manager.mark_exhausted.assert_not_called()

    def test_reported_usage_falls_back_when_the_response_is_silent(self):
        credits = record_reported_usage(self.key_manager, "k", {"results": []}, fallback=5)
        self.assertEqual(credits, 5)
        self.key_manager.record_usage.assert_called_once_with("k", credits=5)


# ── Le tri des URL cartographiees ─────────────────────────────────

class TestProgramPageFilter(unittest.TestCase):
    """
    Le filtre ne peut pas exiger que la fiche descende de la page catalogue :
    EM Normandie range /programmes/... sous /programmes, Em Lyon range son
    index en /fr/nos-programmes et ses fiches en /fr/etudiant/... Exiger le
    prefixe rejetterait une ecole sur deux.
    """

    def test_em_normandie_fiches_are_kept(self):
        for url in (
            "https://www.em-normandie.com/programmes/bachelor-management/alternance",
            "https://www.em-normandie.com/programmes/mastere-specialise-master-science",
        ):
            self.assertTrue(looks_like_program_page(url, "/programmes"), url)

    def test_em_lyon_fiches_are_kept_despite_another_path_root(self):
        for url in (
            "https://em-lyon.com/fr/etudiant/mastere-specialise/ms-juriste-manager-international",
            "https://em-lyon.com/fr/programmes-master",
            "https://em-lyon.com/fr/programme-grande-ecole-pge",
        ):
            self.assertTrue(looks_like_program_page(url, "/fr/nos-programmes"), url)

    def test_known_noise_is_dropped(self):
        for url in (
            "https://em-lyon.com/fr/etudiant/guides/dossier-sur-le-bba",
            "https://em-lyon.com/fr/actualites/remise-des-diplomes-emlyon",
            "https://em-lyon.com/fr/classements-accreditations",
            "https://www.em-normandie.com/annuaire-des-professeurs/laetitia-condamin",
            "https://www.em-normandie.com/programmes/brochure.pdf",
        ):
            self.assertFalse(looks_like_program_page(url, "/fr/nos-programmes"), url)

    def test_the_index_page_itself_is_not_a_fiche(self):
        self.assertFalse(
            looks_like_program_page("https://em-lyon.com/fr/nos-programmes", "/fr/nos-programmes")
        )

    def test_explicit_prefix_narrows_when_asked(self):
        url = "https://em-lyon.com/fr/etudiant/mastere-specialise/ms-juriste-manager-international"
        self.assertTrue(looks_like_program_page(url, "/fr/nos-programmes", "/fr/etudiant"))
        self.assertFalse(looks_like_program_page(url, "/fr/nos-programmes", "/fr/executive"))


class TestEmptyResponsesAreNotCached(unittest.TestCase):
    """
    Un /map revenu vide sur une cle presque epuisee a ete observe le
    4 septembre. Mis en cache, ce vide gele la collecte : tous les passages
    suivants repartent de rien sans jamais rappeler l'API.
    """

    def test_empty_map_and_search_are_not_worth_caching(self):
        self.assertFalse(_is_worth_caching("map", [[], 0]))
        self.assertFalse(_is_worth_caching("search", [[], 1]))
        self.assertTrue(_is_worth_caching("map", [["https://x.fr/a"], 5]))

    def test_empty_extract_and_extraction_are_not_worth_caching(self):
        self.assertFalse(_is_worth_caching("extract", ""))
        self.assertFalse(_is_worth_caching("gemini", {"statements": []}))
        self.assertTrue(_is_worth_caching("gemini", {"statements": [{"a": 1}]}))

# ── Fixtures de PAGE ─────────────────────────────────────────────
#
# Recopiees mot pour mot du markdown rendu par /extract et conserve dans
# tmp/dry-cache. Elles sont la matiere des deux gardes : ce sont ces textes,
# et pas la sortie du modele, qui decident.

# La page catalogue d'Em Lyon. Une rubrique d'executive education est
# typographiquement une carte — titre, blurb, puces dont une nomme les lieux —
# mais son lien porte le mot « Decouvrir » et vise une facette de recherche.
EM_LYON_CATALOG_PAGE = """# Nos programmes

Gouvernance

Ces formations vous aident a comprendre et a gerer les enjeux strategiques lies a la gouvernance d'entreprise.

* Gouvernance durable et responsabilite societale
* Paris ou Lyon

[Decouvrir](https://em-lyon.com/fr/programmes?title=&target=All&domain%5B6%5D=6&duration_custom=month)

Grades Masters & Masters of Science (MSc)

Des programmes d'excellence ouverts aux etudiants francais et internationaux.

* Campus Lyon ou Paris et a l'international

[Decouvrir](/fr/programmes-master "Grades Master & MSc")
"""

# Une page d'index d'EM Normandie. Ici la carte ENTIERE tient dans l'ancrage
# d'un seul lien : titre, « Campus », valeur. C'est ce qui lui donne des bords.
EM_NORMANDIE_INDEX_PAGE = """# Mastere Specialise, Master of Science

* ## Finance

  + [sur dossier

    ### MSc Banking, Finance and FinTech

    Anglais

    Post Bac+3/4

    Niveau

    Bac +5

    Campus

    Oxford

    Rythme

    Presentiel

    En savoir +](https://www.em-normandie.com/programmes/votre-formation-en-finance/msc-banking-finance-and-fintech)
"""

# Un Mastere Specialise d'Em Lyon : douze mois, pas une seule mention d'annee,
# et pourtant un titre « Campus d'affectation » — qui parle de CHOIX de campus,
# pas de repartition par annee.
EM_LYON_MS_PAGE = """1. Accueil
2. Mastere Specialise Juriste Manager International

Campus

Lyon ou Paris

Duree

12 mois

Rythme

Alternance

#### Campus d'affectation

Le programme en parcours alternance est ouvert pour la rentree de septembre 2025 sur les campus de Paris et Lyon.
"""

# Le PGE en 5 ans : un vrai titre de rattachement, et les annees nommees.
EM_NORMANDIE_PGE_PAGE = """1. Accueil
2. Programme Grande Ecole en 5 ans

## Campus de rattachement

+ **1re annee**
   Caen ou Paris - cours en francais ou en anglais
   Dubai, Dublin ou Oxford - cours en anglais
+ **2e annee**
   Caen ou Paris - cours en francais ou en anglais
+ **4e et 5e annees**
   en fonction de l'orientation choisie
"""

# Le MSc 2-year Programme : les annees SONT publiees, mais sous des titres qui
# decrivent le contenu de l'annee. Aucun titre de rattachement.
EM_NORMANDIE_TWO_YEAR_PAGE = """1. Accueil
2. MSc 2-year Programme

## Annee 1 : Pre-MSc

Effectuez votre annee sur le campus de Paris et rencontrez plus de 1000 etudiants internationaux.

## Annee 2 : MSc Track de votre choix

Cette annee s'effectue sur le campus ou la specialisation est dispensee.

+ [**MSc Creative and Cultural Industries**](/programmes/votre-formation-en-marketing-digital/msc-creative-and-cultural-industry) - Caen
"""


class TestPageEvidenceReading(unittest.TestCase):
    """Ce que le depouillement lit dans une page, avant toute decision."""

    def test_published_years_reads_a_range_written_as_one_bullet(self):
        # « 4e et 5e annees » nomme DEUX annees dans un seul intitule.
        self.assertEqual(
            published_years(EM_NORMANDIE_PGE_PAGE), frozenset({1, 2, 4, 5})
        )

    def test_a_twelve_month_programme_publishes_no_year(self):
        # C'est le fait qui rend fausses les six lignes-annees des trois MS.
        self.assertEqual(published_years(EM_LYON_MS_PAGE), frozenset())

    def test_year_headings_of_a_curriculum_are_read_as_years(self):
        self.assertEqual(
            published_years(EM_NORMANDIE_TWO_YEAR_PAGE), frozenset({1, 2})
        )

    def test_a_price_or_a_date_is_not_a_year(self):
        self.assertEqual(
            published_years("Frais de scolarite : 34 900 EUR (annee academique 2026-2027)"),
            frozenset(),
        )

    def test_attachment_heading_is_recognised_in_both_wordings(self):
        self.assertTrue(has_attachment_heading(EM_NORMANDIE_PGE_PAGE))
        self.assertTrue(has_attachment_heading(EM_LYON_MS_PAGE))

    def test_a_year_heading_is_not_an_attachment_heading(self):
        # « ## Annee 1 : Pre-MSc » decrit le contenu d'une annee, pas un
        # rattachement. C'est toute la difference entre une table et un cursus.
        self.assertFalse(has_attachment_heading(EM_NORMANDIE_TWO_YEAR_PAGE))

    def test_a_facet_url_is_not_a_fiche(self):
        self.assertFalse(
            _href_is_usable(
                "https://em-lyon.com/fr/programmes?title=&target=All&domain%5B6%5D=6"
            )
        )
        self.assertFalse(_href_is_usable("#main-content"))
        self.assertFalse(_href_is_usable("/sites/default/files/msc-esg.jpg"))
        self.assertTrue(
            _href_is_usable(
                "https://www.em-normandie.com/programmes/votre-formation-en-finance/msc-banking-finance-and-fintech"
            )
        )


class TestCardMustLeadToAFiche(unittest.TestCase):
    """
    Garde 1. Les cinq rubriques d'Em Lyon tombent, les programmes que seule
    leur carte fait connaitre restent.
    """

    def test_a_rubric_whose_title_is_not_a_link_has_no_card(self):
        evidence = build_page_evidence({"cat": EM_LYON_CATALOG_PAGE})
        self.assertEqual(evidence.backing_cards("Gouvernance", "Lyon"), [])
        self.assertEqual(
            evidence.backing_cards("Grades Masters & Masters of Science (MSc)", "Paris"),
            [],
        )

    def test_a_real_card_carries_its_title_and_its_campus(self):
        evidence = build_page_evidence({"idx": EM_NORMANDIE_INDEX_PAGE})
        self.assertEqual(
            evidence.backing_cards("MSc Banking, Finance and FinTech", "Oxford"),
            [
                "https://www.em-normandie.com/programmes/votre-formation-en-finance/"
                "msc-banking-finance-and-fintech"
            ],
        )

    def test_a_card_that_does_not_name_the_campus_backs_nothing(self):
        evidence = build_page_evidence({"idx": EM_NORMANDIE_INDEX_PAGE})
        self.assertEqual(
            evidence.backing_cards("MSc Banking, Finance and FinTech", "Caen"), []
        )

    def test_the_five_rubrics_produce_no_row_at_all(self):
        raw = {
            "statements": [
                stmt("Gouvernance", "INDEX_CARD", 0, "ANY", "Lyon"),
                stmt("Gouvernance", "INDEX_CARD", 0, "ANY", "Paris"),
                stmt("Grades Masters & Masters of Science (MSc)", "INDEX_CARD", 0, "ANY", "Lyon"),
            ]
        }
        rows = build_rows(raw, EM_LYON_CAMPUSES, pages={"cat": EM_LYON_CATALOG_PAGE})
        self.assertEqual(rows["totals"]["programs"], 0)
        self.assertEqual(rows["totals"]["program_campus"], 0)
        self.assertEqual(rows["totals"]["statements_guarded"], 3)
        self.assertTrue(
            all(g["guard"] == "card_without_fiche" for g in rows["guarded_statements"])
        )

    def test_the_shortcut_that_would_kill_nine_real_programmes_is_not_taken(self):
        # Le raccourci « jeter tout programme dont les lignes ne viennent que
        # d'INDEX_CARD » tue les rubriques ET ce programme, dont la fiche n'a
        # pas ete lue. C'est la carte qu'on qualifie, pas la zone.
        raw = {
            "statements": [
                stmt(
                    "MSc Banking, Finance and FinTech", "INDEX_CARD", 0, "ANY", "Oxford",
                    verbatim="Campus\n\nOxford",
                )
            ]
        }
        rows = build_rows(
            raw, EM_NORMANDIE_CAMPUSES, pages={"idx": EM_NORMANDIE_INDEX_PAGE}
        )
        program = program_of(rows, "MSc Banking, Finance and FinTech")
        self.assertEqual(
            [r["campusName"] for r in program["program_campus"]], ["Oxford"]
        )
        self.assertEqual(rows["totals"]["statements_guarded"], 0)


class TestSectionYearMustBePublished(unittest.TestCase):
    """
    Garde 2. Une section ne fait naitre une ligne-annee que si la page publie
    l'annee ET declare un rattachement. Sinon la zone est DEGRADEE : l'arete
    reste, la ligne fille disparait.
    """

    MS_STATEMENTS = {
        "statements": [
            stmt("Mastere Specialise Juriste Manager International", "SECTION", 1, "ANY",
                 "Lyon", verbatim="De Septembre a Aout : Lyon ou Paris",
                 url="ms-juriste"),
            stmt("Mastere Specialise Juriste Manager International", "SECTION", 1, "ANY",
                 "Paris", verbatim="De Septembre a Aout : Lyon ou Paris",
                 url="ms-juriste"),
        ]
    }

    def test_without_the_guard_a_one_year_programme_invents_two_year_rows(self):
        rows = build_rows(self.MS_STATEMENTS, EM_LYON_CAMPUSES)
        self.assertEqual(rows["totals"]["program_campus_attachment"], 2)

    def test_with_the_guard_the_edge_stays_and_the_year_rows_go(self):
        rows = build_rows(
            self.MS_STATEMENTS, EM_LYON_CAMPUSES, pages={"ms-juriste": EM_LYON_MS_PAGE}
        )
        program = program_of(rows, "Mastere Specialise Juriste Manager International")
        # Le lieu est publie : les deux aretes restent, c'est le sens actuel.
        self.assertEqual(
            [r["campusName"] for r in program["program_campus"]], ["Lyon", "Paris"]
        )
        # L'annee ne l'est pas : zero ligne fille, et zero conflit invente.
        self.assertEqual(program["program_campus_attachment"], [])
        self.assertFalse(program["has_section"])
        self.assertEqual(program["conflicts"], [])
        reasons = {g["reason"] for g in rows["guarded_statements"]}
        self.assertEqual(reasons, {"year_not_published:1"})

    def test_a_real_attachment_section_still_produces_its_rows(self):
        raw = {
            "statements": [
                stmt("Programme Grande Ecole en 5 ans", "SECTION", 1, "ANY", "Caen",
                     languages=["FR", "EN"], url="pge5"),
                stmt("Programme Grande Ecole en 5 ans", "SECTION", 2, "ANY", "Caen",
                     languages=["FR", "EN"], url="pge5"),
            ]
        }
        rows = build_rows(
            raw, EM_NORMANDIE_CAMPUSES, pages={"pge5": EM_NORMANDIE_PGE_PAGE}
        )
        program = program_of(rows, "Programme Grande Ecole en 5 ans")
        self.assertEqual(
            [(r["campusName"], r["study_year"]) for r in program["program_campus_attachment"]],
            [("Caen", 1), ("Caen", 2)],
        )
        self.assertEqual(rows["totals"]["statements_guarded"], 0)

    def test_a_curriculum_plan_is_not_an_attachment_section(self):
        # Les annees sont bien publiees ; le titre de rattachement, non. La
        # ligne annee 2 est deduite d'une liste de programmes VOISINS.
        raw = {
            "statements": [
                stmt("MSc 2-year Programme", "SECTION", 1, "ANY", "Paris",
                     verbatim="Effectuez votre annee sur le campus de Paris",
                     url="two-year"),
                stmt("MSc 2-year Programme", "SECTION", 2, "ANY", "Caen",
                     verbatim="MSc Creative and Cultural Industries - Caen",
                     url="two-year"),
            ]
        }
        rows = build_rows(
            raw, EM_NORMANDIE_CAMPUSES, pages={"two-year": EM_NORMANDIE_TWO_YEAR_PAGE}
        )
        program = program_of(rows, "MSc 2-year Programme")
        self.assertEqual(program["program_campus_attachment"], [])
        self.assertEqual(
            sorted(r["campusName"] for r in program["program_campus"]), ["Caen", "Paris"]
        )
        self.assertEqual(
            {g["reason"] for g in rows["guarded_statements"]}, {"no_attachment_heading"}
        )

    def test_a_year_without_place_and_without_proof_leaves_no_conflict(self):
        raw = {
            "statements": [
                stmt("Mastere Specialise Juriste Manager International", "SECTION", 4,
                     "ANY", None, verbatim="en fonction du parcours", url="ms-juriste")
            ]
        }
        rows = build_rows(
            raw, EM_LYON_CAMPUSES, pages={"ms-juriste": EM_LYON_MS_PAGE}
        )
        self.assertEqual(rows["totals"]["conflicts"], 0)
        self.assertEqual(rows["totals"]["statements_guarded"], 1)

    def test_the_guards_are_off_when_no_page_is_supplied(self):
        # Le collecteur doit pouvoir rejouer la sortie d'AVANT les gardes, sans
        # quoi leur effet ne serait qu'annonce.
        rows = build_rows(self.MS_STATEMENTS, EM_LYON_CAMPUSES, pages=None)
        self.assertEqual(rows["totals"]["statements_guarded"], 0)
        self.assertEqual(rows["guarded_statements"], [])


class TestMultiCampusFieldIsSplitByTheCampusList(unittest.TestCase):
    """
    L'encart des deux fiches PGE publie cinq lieux dans une seule valeur. Le
    decoupage n'est sur que parce que la liste des campus le borne.
    """

    FOLDS = {"caen": "Caen", "le havre": "Le Havre", "paris": "Paris",
             "dublin": "Dublin", "oxford": "Oxford", "dubai": "Dubai"}

    def test_a_fully_covered_string_is_split(self):
        self.assertEqual(
            split_multi_campus_label("Caen Le Havre Paris Dublin Oxford", self.FOLDS),
            ["Caen", "Le Havre", "Paris", "Dublin", "Oxford"],
        )

    def test_the_longest_campus_name_wins(self):
        # « Le Havre » est un lieu, pas deux.
        self.assertEqual(
            split_multi_campus_label("Caen Le Havre", self.FOLDS), ["Caen", "Le Havre"]
        )

    def test_a_string_with_any_residue_is_left_intact(self):
        for label in ("Lyon, France", "UniLaSalle Rouen",
                      "campus Institut Lyfe avec une experience internationale",
                      "Paris et New York ou Londres"):
            self.assertEqual(split_multi_campus_label(label, self.FOLDS), [], label)

    def test_a_single_campus_is_not_this_rule_s_business(self):
        self.assertEqual(split_multi_campus_label("Paris", self.FOLDS), [])

    def test_the_pge_field_no_longer_produces_a_placeless_placement(self):
        raw = {
            "statements": [
                stmt("Programme Grande Ecole en 2 ou 3 ans", "FIELD", 0, "ANY",
                     "Caen Le Havre Paris Dublin Oxford",
                     verbatim="Caen Le Havre Paris Dublin Oxford")
            ]
        }
        rows = build_rows(raw, EM_NORMANDIE_CAMPUSES)
        program = program_of(rows, "Programme Grande Ecole en 2 ou 3 ans")
        self.assertEqual(program["program_placement"], [])
        self.assertEqual(
            sorted(r["campusName"] for r in program["program_campus"]),
            ["Caen", "Dublin", "Le Havre", "Oxford", "Paris"],
        )


if __name__ == "__main__":
    unittest.main()
