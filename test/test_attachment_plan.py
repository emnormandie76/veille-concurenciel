"""
Le plan d'un ticket de rattachement, calcule en Python avant de le deposer.

`backend/pipeline/attachment_plan.py` porte en Python le plan de
`lib/campus-attachment.ts`, parce que la Phase 1 doit savoir si un ticket a
quelque chose a ecrire AVANT de le deposer, et qu'elle n'a aucun canal vers
l'application Next. Deux implementations d'une meme comparaison divergent un
jour si rien ne les tient : `test/fixtures/attachment_plan_cases.json` les
tient. Ce fichier et `test/campus-attachment.test.ts` lisent les memes cas, et
chacun doit rendre le plan ecrit a la main dans le fichier.
"""

import json
import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.pipeline.attachment_plan import (  # noqa: E402
    build_attachment_claims,
    build_policy_note_claims,
    plan_ticket_writes,
)

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "attachment_plan_cases.json")


def load_cases():
    with open(FIXTURE, encoding="utf-8") as handle:
        doc = json.load(handle)
    corpus = doc["corpus"]
    refs = {
        "corpus": None,  # resolu par champ ci-dessous
        "corpus_written": corpus["written"],
        "corpus_note_written": corpus["programs_note_written"],
    }

    def resolve(field, value):
        if value == "corpus":
            return corpus[field]
        if isinstance(value, str) and value in refs:
            return refs[value]
        return value

    cases = []
    for case in doc["cases"]:
        cases.append({
            "name": case["name"],
            "school_id": resolve("school_id", case["school_id"]),
            "edges": resolve("edges", case["edges"]),
            "programs": resolve("programs", case["programs"]),
            "ticket": resolve("ticket", case["ticket"]),
            "existing": resolve("existing", case["existing"]),
            "expected": case["expected"],
        })
    return cases


class TestSharedPlanCases(unittest.TestCase):
    """Les cas partages avec la suite TypeScript, un par un."""

    def test_every_shared_case_gives_the_hand_written_plan(self):
        cases = load_cases()
        self.assertGreaterEqual(len(cases), 20)
        for case in cases:
            with self.subTest(case["name"]):
                snapshot = SimpleNamespace(
                    school_id=case["school_id"],
                    edges=case["edges"],
                    attachments=case["existing"],
                    programs=case["programs"],
                )
                plan = plan_ticket_writes(case["ticket"], snapshot)
                got = {
                    "attachments": plan["counts"]["attachments"],
                    "policy_notes": plan["counts"]["policy_notes"],
                    "conflicts": plan["counts"]["conflicts"],
                    "writes": plan["writes"],
                }
                self.assertEqual(got, case["expected"])

    def test_the_real_corpus_asks_for_nothing_once_written(self):
        # Le cas qui fonde la garde contre l'inondation : apres l'ecriture du
        # 15 septembre et la note posee, rejouer la meme collecte n'a rien a
        # montrer.
        case = next(c for c in load_cases() if "rien a ecrire, aucun ticket" in c["name"])
        self.assertEqual(case["expected"]["writes"], 0)

    def test_the_written_rows_are_not_rewritten_in_python_either(self):
        case = next(c for c in load_cases() if "seule la note reste" in c["name"])
        snapshot = SimpleNamespace(
            school_id=case["school_id"], edges=case["edges"],
            attachments=case["existing"], programs=case["programs"],
        )
        plan = plan_ticket_writes(case["ticket"], snapshot)
        self.assertEqual(plan["attachments"]["create"], [])
        self.assertEqual(plan["attachments"]["update"], [])
        self.assertEqual(
            [w["program"] for w in plan["policy_notes"]["create"]],
            ["International Bachelor in Business Administration"],
        )


# ── La charge du ticket, sur les noms reels ──────────────────────

EM_LYON = SimpleNamespace(
    school_id="school-lyon",
    campuses=[
        {"id": "c-bhu", "name": "Campus Bhubaneswar"},
        {"id": "c-ste", "name": "Campus Saint‑Étienne"},
        {"id": "c-lyon", "name": "Lyon campus"},
        {"id": "c-paris", "name": "Paris campus"},
    ],
    programs=[
        {"id": "p-bba", "name": "Global BBA", "campus_policy_note": None},
        {"id": "p-bm", "name": "Bachelor Management", "campus_policy_note": None},
        {"id": "p-bmd", "name": "Bachelor Management, Data et IA Responsables", "campus_policy_note": None},
    ],
    edges=[],
    attachments=[],
)


def fiche(name, rows=(), note=None):
    return {
        "program": name,
        "campus_policy_note": note,
        "program_campus_attachment": [
            {"campusName": c, "study_year": y, "regime": r, "languages": ["FR"], "note": None,
             "source_url": f"https://x/{name}"}
            for c, y, r in rows
        ],
    }


class TestTicketPayload(unittest.TestCase):
    def test_claims_carry_real_ids_and_db_names(self):
        claims, unresolved = build_attachment_claims(
            [fiche("Global BBA", [("Lyon campus", 1, "ANY"), ("Saint-Étienne", 2, "ANY")])], EM_LYON
        )
        self.assertEqual(unresolved, [])
        self.assertEqual(
            [(c["programId"], c["campusId"], c["campus"], c["study_year"]) for c in claims],
            [("p-bba", "c-lyon", "Lyon campus", 1), ("p-bba", "c-ste", "Campus Saint‑Étienne", 2)],
        )

    def test_a_variant_fiche_attaches_to_its_diploma(self):
        # Clause B : « en 3 ans » est une modalite.
        claims, _ = build_attachment_claims(
            [fiche("Bachelor Management en 3 ans", [("Paris campus", 3, "ALTERNANCE")])], EM_LYON
        )
        self.assertEqual([c["programId"] for c in claims], ["p-bm"])

    def test_nothing_unmatched_enters_the_payload(self):
        claims, unresolved = build_attachment_claims(
            [
                fiche("MSc Inconnu", [("Lyon campus", 1, "ANY")]),
                fiche("Global BBA", [("Mumbai", 1, "ANY")]),
            ],
            EM_LYON,
        )
        self.assertEqual(claims, [])
        self.assertEqual(
            sorted(u["reason"] for u in unresolved), ["campus_unmatched", "program_unmatched"]
        )

    def test_a_campus_key_shared_by_two_db_names_resolves_nothing(self):
        snapshot = SimpleNamespace(
            campuses=[{"id": "a", "name": "Paris"}, {"id": "b", "name": "Paris campus"}],
            programs=EM_LYON.programs,
        )
        claims, unresolved = build_attachment_claims([fiche("Global BBA", [("Paris", 1, "ANY")])], snapshot)
        self.assertEqual(claims, [])
        self.assertEqual(unresolved[0]["reason"], "campus_unmatched")

    def test_policy_notes_need_one_matched_program(self):
        notes, unresolved = build_policy_note_claims(
            [
                fiche("Global BBA", note="Paris reste accessible chaque année."),
                fiche("Programme inconnu", note="Une phrase."),
                fiche("Bachelor Management"),
            ],
            EM_LYON,
        )
        self.assertEqual([(n["programId"], n["note"]) for n in notes], [("p-bba", "Paris reste accessible chaque année.")])
        self.assertEqual([u["fiche"] for u in unresolved], ["Programme inconnu"])


if __name__ == "__main__":
    unittest.main()
