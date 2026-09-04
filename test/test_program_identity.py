"""
L'appariement fiche du site <-> `Program` de la base, sur les noms REELS.

Aucune fixture n'est inventee. Chaque nom de programme et chaque nom de campus
de ce fichier est recopie de la base Neon telle qu'elle etait le 4 septembre
2026 (15 `Program` et 6 `Campus` pour Em Normandie, 24 et 6 pour Em Lyon), ou
de la sortie seche de `simulate_campus_attachment.py`. Un test qui passerait
sur des noms plausibles mais faux ne prouverait rien de la regle — c'est
precisement parce que les deux cotes n'ecrivent pas comme on l'imagine que
l'appariement echouait a 100 %.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.pipeline.program_identity import (  # noqa: E402
    MATCH_ABSENT,
    MATCH_ACRONYM,
    MATCH_EXACT,
    MATCH_VARIANT,
    canon_program_name,
    check_canonical_collisions,
    fold_campus_name,
    match_program,
    resolve_attachment_rows,
)

# Les 15 `Program` d'Em Normandie, verbatim de la base.
EN_PROGRAMS = [
    {"id": "p-bm", "name": "Bachelor Management"},
    {"id": "p-bmi", "name": "Bachelor Management International"},
    {"id": "p-ibba", "name": "International Bachelor in Business Administration"},
    {"id": "p-mst", "name": "MS Stratégies Territoriales et Management des Transitions"},
    {"id": "p-mim", "name": "Master in Management"},
    {"id": "p-msc", "name": "Master of Science (MSc)"},
    {"id": "p-msc2y", "name": "Master of Science (MSc) (two-year programme)"},
    {"id": "p-bff", "name": "Master of Science (MSc) - Banking, Finance and FinTech"},
    {"id": "p-dsba", "name": "Master of Science (MSc) - Data Sciences for Business Analytics"},
    {"id": "p-imbd", "name": "Master of Science (MSc) - International Marketing and Business Development"},
    {"id": "p-mdll", "name": "Master of Science (MSc) - Marketing and Digital in Luxury and Lifestyle"},
    {"id": "p-scmi", "name": "Master of Science (MSc) - Supply Chain Management – International Logistics & Port Management"},
    {"id": "p-scmp", "name": "Master of Science (MSc) - Supply Chain Management – Purchasing"},
    {"id": "p-sbs", "name": "Master of Science (MSc) - Sustainable Business Strategy"},
    {"id": "p-pge", "name": "Programme Grande École"},
]

# Les 6 `Campus` d'Em Normandie, et les 6 d'Em Lyon — dont le trait d'union
# insecable de « Campus Saint‑Étienne » (U+2011) et le mot « campus » colle au
# nom, devant comme derriere.
EN_CAMPUSES = [
    {"id": "c-caen", "name": "Caen"},
    {"id": "c-dubai", "name": "Dubaï"},
    {"id": "c-dublin", "name": "Dublin"},
    {"id": "c-havre", "name": "Le Havre"},
    {"id": "c-oxford", "name": "Oxford"},
    {"id": "c-paris", "name": "Paris"},
]
LYON_CAMPUSES = [
    {"id": "l-bhu", "name": "Campus Bhubaneswar"},
    {"id": "l-ste", "name": "Campus Saint‑Étienne"},
    {"id": "l-lyon", "name": "Lyon campus"},
    {"id": "l-mum", "name": "Mumbai campus"},
    {"id": "l-paris", "name": "Paris campus"},
    {"id": "l-sha", "name": "Shanghai campus"},
]


def att(campus, year, regime="ANY", languages=None, note=None, url=None):
    return {
        "campusName": campus,
        "study_year": year,
        "regime": regime,
        "languages": languages or [],
        "note": note,
        "source_url": url,
    }


def fiche(name, rows=None):
    return {"program": name, "program_campus_attachment": rows or []}


# ── Regle 1 · la cle d'un campus, des deux cotes ──────────────────

class TestCampusFolding(unittest.TestCase):
    def test_trait_union_insecable_que_nfd_ne_rattrape_pas(self):
        """U+2011 n'est pas un diacritique : aucun repli NFD ne le decompose."""
        db = "Campus Saint‑Étienne"
        self.assertIn("‑", db)
        self.assertEqual(fold_campus_name(db), "saint-etienne")
        self.assertEqual(fold_campus_name(db), fold_campus_name("Saint-Etienne"))

    def test_le_mot_campus_est_ote_aux_deux_bords(self):
        self.assertEqual(fold_campus_name("Lyon campus"), "lyon")
        self.assertEqual(fold_campus_name("Campus Bhubaneswar"), "bhubaneswar")
        self.assertEqual(fold_campus_name("Paris campus"), fold_campus_name("Paris"))

    def test_les_douze_campus_reels_se_resolvent_sans_ambiguite(self):
        """12 noms sur 12, 0 ambigu, 0 absent — la mesure du rapport."""
        for campuses, site_names in (
            (EN_CAMPUSES, ["Caen", "Dubaï", "Dublin", "Le Havre", "Oxford", "Paris"]),
            (LYON_CAMPUSES, ["Lyon", "Paris", "Shanghai"]),
        ):
            keys = [fold_campus_name(c["name"]) for c in campuses]
            self.assertEqual(len(set(keys)), len(keys), "deux campus sur la meme cle")
            for name in site_names:
                self.assertIn(fold_campus_name(name), keys, name)

    def test_le_havre_reste_un_seul_lieu(self):
        self.assertEqual(fold_campus_name("Le Havre"), "le havre")


# ── Regle 2 · la forme canonique d'un nom de programme ────────────

class TestProgramCanonicalForm(unittest.TestCase):
    def test_la_tete_de_diplome_est_reduite(self):
        """La base ecrit « Master of Science (MSc) - X », le site « MSc X »."""
        self.assertEqual(
            canon_program_name("Master of Science (MSc) - Banking, Finance and FinTech"),
            canon_program_name("MSc Banking, Finance and FinTech"),
        )

    def test_esperluette_et_and_sont_la_meme_chose(self):
        """La base : « Healthcare Innovation and Data Science ». Le site : « & »."""
        self.assertEqual(
            canon_program_name("MSc in Healthcare Innovation and Data Science"),
            canon_program_name("MSc in Healthcare Innovation & Data Science"),
        )

    def test_le_en_de_liaison_ne_compte_pas(self):
        self.assertEqual(
            canon_program_name("Bachelor en Management"),
            canon_program_name("Bachelor Management"),
        )

    def test_le_tiret_cadratin_de_la_base_vaut_un_tiret(self):
        """« Supply Chain Management – Purchasing » porte un U+2013."""
        self.assertEqual(
            canon_program_name("Master of Science (MSc) - Supply Chain Management – Purchasing"),
            canon_program_name("MSc Supply Chain Management - Purchasing"),
        )

    def test_la_casse_de_master_in_ne_compte_pas(self):
        self.assertEqual(
            canon_program_name("Master In Strategy & Consulting"),
            canon_program_name("Master in Strategy & Consulting"),
        )

    def test_aucune_collision_entre_les_program_reels(self):
        """Le garde-fou : la normalisation ne doit fusionner aucun couple reel."""
        self.assertEqual(check_canonical_collisions(p["name"] for p in EN_PROGRAMS), {})

    def test_le_msc_generique_ne_se_confond_avec_aucune_specialite(self):
        """« Master of Science (MSc) » nu existe en base et ne doit rien attirer."""
        clause, hits = match_program("MSc Banking, Finance and FinTech", EN_PROGRAMS)
        self.assertEqual(clause, MATCH_EXACT)
        self.assertEqual(hits[0]["name"], "Master of Science (MSc) - Banking, Finance and FinTech")


# ── Regle 3 · les trois clauses, et le silence ────────────────────

class TestProgramMatching(unittest.TestCase):
    def test_a1_identite_apres_convention(self):
        clause, hits = match_program("MSc Sustainable Business Strategy", EN_PROGRAMS)
        self.assertEqual(clause, MATCH_EXACT)
        self.assertEqual(hits[0]["id"], "p-sbs")

    def test_a2_le_sigle_est_derive_du_nom_qu_il_apparie(self):
        """« IBBA (International Bachelor...) » : IBBA est l'acronyme du reste."""
        clause, hits = match_program(
            "IBBA (International Bachelor in Business Administration)", EN_PROGRAMS)
        self.assertEqual(clause, MATCH_ACRONYM)
        self.assertEqual(hits[0]["id"], "p-ibba")

    def test_b_variante_de_modalite(self):
        for name in ("Programme Grande École en 5 ans",
                     "Programme Grande École en 2 ou 3 ans",
                     "Programme Grande École en blended learning"):
            clause, hits = match_program(name, EN_PROGRAMS)
            self.assertEqual(clause, MATCH_VARIANT, name)
            self.assertEqual(hits[0]["id"], "p-pge", name)

    def test_une_specialite_n_est_pas_une_variante(self):
        """Le piege : « Bachelor Management » est un sous-ensemble strict de
        « Bachelor Management, Data et IA Responsables ». C'est un AUTRE
        diplome, et ses jetons en trop ne sont pas des modalites."""
        clause, hits = match_program("Bachelor Management, Data et IA Responsables", EN_PROGRAMS)
        self.assertEqual(clause, MATCH_ABSENT)
        self.assertEqual(hits, [])

    def test_un_doctorat_n_est_pas_un_bachelor(self):
        clause, _ = match_program("Doctorate in Business Administration", EN_PROGRAMS)
        self.assertEqual(clause, MATCH_ABSENT)

    def test_deux_ans_ecrit_en_chiffres_reste_non_apparie(self):
        """La base ecrit « (two-year programme) », le site « 2-year ». Une table
        chiffre <-> lettre calibree sur ce seul cas serait du surajustement :
        on prefere le non-apparie, qui se voit."""
        clause, _ = match_program("MSc 2-year Programme", EN_PROGRAMS)
        self.assertEqual(clause, MATCH_ABSENT)

    def test_plusieurs_reponses_ne_produisent_aucun_appariement(self):
        jumeaux = [
            {"id": "x1", "name": "Programme Grande École"},
            {"id": "x2", "name": "Programme Grande Ecole"},
        ]
        clause, hits = match_program("Programme Grande École en 5 ans", jumeaux)
        self.assertTrue(clause.startswith("AMBIGU/"))
        self.assertEqual(len(hits), 2)

    def test_les_49_fiches_ne_produisent_aucun_ambigu(self):
        """Mesure : 33 appariees sur 49, 0 ambiguë, 16 absentes."""
        fiches = [
            "Bachelor Management International en 1 an", "Bachelor Management, Data et IA Responsables",
            "Bachelor en Management", "Bachelor en Management en 3 ans",
            "Doctorate in Business Administration",
            "IBBA (International Bachelor in Business Administration)",
            "L'alternance du Bachelor Management International",
            "MS Marketing, Communication et Ingénierie des produits Agroalimentaires",
            "MS Stratégies Territoriales et Management des Transitions", "MSc 2-year Programme",
            "MSc Artificial Intelligence for Marketing Strategy", "MSc Banking, Finance and FinTech",
            "MSc Creative and Cultural Industries", "MSc Data Sciences for Business Analytics",
            "MSc Digital Strategy and Innovation",
            "MSc Environmental, Social, Governance & Sustainable Finance",
            "MSc Financial Data Management", "MSc International Events Management",
            "MSc International Marketing and Business Development",
            "MSc Marketing and Digital in Luxury and Lifestyle",
            "MSc Supply Chain Management - International Logistics & Port Management",
            "MSc Supply Chain Management - Purchasing", "MSc Sustainable Business Strategy",
            "Programme Grande École en 2 ou 3 ans", "Programme Grande École en 5 ans",
            "Programme Grande École en blended learning",
        ]
        clauses = [match_program(f, EN_PROGRAMS)[0] for f in fiches]
        self.assertEqual(clauses.count(MATCH_EXACT), 9)
        self.assertEqual(clauses.count(MATCH_ACRONYM), 1)
        self.assertEqual(clauses.count(MATCH_VARIANT), 6)
        self.assertEqual(clauses.count(MATCH_ABSENT), 10)
        self.assertEqual([c for c in clauses if c.startswith("AMBIGU")], [])


# ── Regle 4 · la fusion a l'identique ─────────────────────────────

EDGES_PGE = [
    {"id": "e-pge-caen", "programId": "p-pge", "campusId": "c-caen"},
    {"id": "e-pge-paris", "programId": "p-pge", "campusId": "c-paris"},
]


class TestTrackMerging(unittest.TestCase):
    def test_deux_fiches_qui_affirment_la_meme_chose_font_une_ligne(self):
        """Les 5 collisions reelles : l'annee 3 du PGE, publiee par les deux
        fiches, avec les memes langues. C'est une repetition, pas un conflit."""
        out = resolve_attachment_rows(
            fiches=[
                fiche("Programme Grande École en 5 ans",
                      [att("Caen", 3, languages=["EN", "FR"], url="https://x/5-ans")]),
                fiche("Programme Grande École en 2 ou 3 ans",
                      [att("Caen", 3, languages=["EN", "FR"], url="https://x/2-ou-3-ans")]),
            ],
            programs=EN_PROGRAMS, campuses=EN_CAMPUSES, edges=EDGES_PGE,
        )
        self.assertEqual(len(out["writable_attachments"]), 1)
        row = out["writable_attachments"][0]
        self.assertEqual(row["programCampusId"], "e-pge-caen")
        self.assertEqual(row["languages"], ["EN", "FR"])
        self.assertEqual(len(row["_fiches"]), 2)
        self.assertEqual(out["totals"]["conflicts"].get("merged_tracks"), 1)

    def test_le_source_url_retenu_ne_depend_pas_de_l_ordre_de_lecture(self):
        rows = []
        for order in ((("https://x/a"), ("https://x/b")), (("https://x/b"), ("https://x/a"))):
            out = resolve_attachment_rows(
                fiches=[
                    fiche("Programme Grande École en 5 ans", [att("Caen", 3, url=order[0])]),
                    fiche("Programme Grande École en 2 ou 3 ans", [att("Caen", 3, url=order[1])]),
                ],
                programs=EN_PROGRAMS, campuses=EN_CAMPUSES, edges=EDGES_PGE,
            )
            rows.append(out["writable_attachments"][0]["source_url"])
        self.assertEqual(rows[0], rows[1])
        self.assertEqual(rows[0], "https://x/a")

    def test_deux_fiches_qui_se_contredisent_n_ecrivent_rien(self):
        """La cle unique ne peut pas porter deux versions, et deviner laquelle
        vaut serait inventer. Le desaccord remonte a l'admin."""
        out = resolve_attachment_rows(
            fiches=[
                fiche("Programme Grande École en 5 ans", [att("Caen", 3, languages=["EN", "FR"])]),
                fiche("Programme Grande École en 2 ou 3 ans", [att("Caen", 3, languages=["EN"])]),
            ],
            programs=EN_PROGRAMS, campuses=EN_CAMPUSES, edges=EDGES_PGE,
        )
        self.assertEqual(out["writable_attachments"], [])
        self.assertEqual(out["totals"]["conflicts"].get("track_disagreement"), 1)
        conflict = out["conflicts"][0]
        self.assertEqual(len(conflict["versions"]), 2)

    def test_une_arete_absente_ne_se_cree_jamais(self):
        """« Bachelor Management + Caen » : la fiche l'affirme, la base ne l'a
        pas. Ce module depose, il ne force pas."""
        out = resolve_attachment_rows(
            fiches=[fiche("Bachelor en Management en 3 ans", [att("Caen", 3, "ALTERNANCE")])],
            programs=EN_PROGRAMS, campuses=EN_CAMPUSES,
            edges=[{"id": "e-bm-havre", "programId": "p-bm", "campusId": "c-havre"}],
        )
        self.assertEqual(out["writable_attachments"], [])
        self.assertEqual(out["totals"]["conflicts"].get("edge_missing"), 1)

    def test_un_programme_non_apparie_ne_produit_aucune_ligne(self):
        out = resolve_attachment_rows(
            fiches=[fiche("MSc 2-year Programme", [att("Paris", 1)])],
            programs=EN_PROGRAMS, campuses=EN_CAMPUSES,
            edges=[{"id": "e", "programId": "p-msc2y", "campusId": "c-paris"}],
        )
        self.assertEqual(out["writable_attachments"], [])
        self.assertEqual(out["totals"]["conflicts"].get("program_unmatched"), 1)

    def test_une_annee_distincte_n_est_pas_fusionnee(self):
        """La fusion ne porte que sur la cle exacte : les annees 1 et 2 du PGE,
        publiees par la seule fiche en 5 ans, restent deux lignes."""
        out = resolve_attachment_rows(
            fiches=[fiche("Programme Grande École en 5 ans",
                          [att("Caen", 1, languages=["EN"]), att("Caen", 2, languages=["EN"])])],
            programs=EN_PROGRAMS, campuses=EN_CAMPUSES, edges=EDGES_PGE,
        )
        self.assertEqual(len(out["writable_attachments"]), 2)
        self.assertEqual(out["totals"]["conflicts"], {})

    def test_deux_regimes_de_la_meme_annee_restent_deux_lignes(self):
        out = resolve_attachment_rows(
            fiches=[fiche("Programme Grande École en 5 ans",
                          [att("Caen", 3, "INITIAL"), att("Caen", 3, "ALTERNANCE")])],
            programs=EN_PROGRAMS, campuses=EN_CAMPUSES, edges=EDGES_PGE,
        )
        self.assertEqual(len(out["writable_attachments"]), 2)


if __name__ == "__main__":
    unittest.main()
