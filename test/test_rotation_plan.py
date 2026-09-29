"""
Mémoire du dernier passage et planificateur de la rotation.

Deux passes par an et par école, Phase 1 comme Phase 2 : le planificateur dit
quelles passes sont dues et dans quel ordre, à partir des jobs `PipelineJob`
terminés. Ces tests tiennent la règle « due », l'ordre de priorité, le coût
estimé, et la purge qui garde la mémoire des passages. Voir
backend/scheduler/rotation.py et docs/features/cron-rotation-production.md,
étape 3.

Tailles réelles : Em Normandie 15 programmes / 30 couples, Em Lyon 24 / 14,
EM Strasbourg 7 / 7.
"""

import logging
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from backend import pipeline_jobs
from backend.pipeline.pending_guard import read_discovery_pending
from backend.pipeline_jobs import LastPass
from backend.scheduler import rotation
from backend.scheduler.rotation import (
    PHASE1_ESTIMATED_CREDITS,
    REASON_INTERVAL,
    REASON_NEVER,
    REASON_RETRY_AFTER_FAILURE,
    RotationConfig,
    SchoolState,
    estimate_phase2_credits,
    plan_rotation,
)
from backend.utils.env import env_int

NOW = datetime(2026, 9, 29, 1, 0, tzinfo=timezone.utc)
CONFIG = RotationConfig(interval_days=182, retry_failed_days=14)

NORMANDIE = SchoolState("s-normandie", "Em Normandie", "ACTIVE", 15, 30)
LYON = SchoolState("s-lyon", "Em Lyon", "ACTIVE", 24, 14)
STRASBOURG = SchoolState("s-strasbourg", "EM Strasbourg", "ACTIVE", 7, 7)
EMLV = SchoolState("s-emlv", "EMLV", "ACTIVE", 0, 0)
ESSEC = SchoolState("s-essec", "Essec", "ACTIVE", 0, 0)


def _ago(days: float) -> datetime:
    return NOW - timedelta(days=days)


def _plan(schools, last_passes=None, discovery_pending=None):
    return plan_rotation(schools, last_passes or {}, discovery_pending or set(), NOW, CONFIG)


def _slots(candidates):
    return [(c.school_name, c.phase) for c in candidates]


# --- La règle « due » ---------------------------------------------------------

def test_une_ecole_sans_passage_est_due_pour_les_deux_phases():
    candidates = _plan([NORMANDIE])

    assert sorted(_slots(candidates)) == [("Em Normandie", "1"), ("Em Normandie", "2")]
    assert {c.reason for c in candidates} == {REASON_NEVER}
    assert all(c.last_pass_at is None for c in candidates)


@pytest.mark.parametrize("days, due", [(181, False), (183, True)])
def test_un_passage_reussi_revient_apres_l_intervalle(days, due):
    last = {("s-normandie", "2"): LastPass("completed", _ago(days))}
    candidates = [c for c in _plan([NORMANDIE], last) if c.phase == "2"]

    assert bool(candidates) is due
    if due:
        assert candidates[0].reason == REASON_INTERVAL
        assert candidates[0].last_pass_at == _ago(days)


@pytest.mark.parametrize("days, due", [(13, False), (15, True)])
def test_un_passage_en_echec_revient_apres_le_delai_court(days, due):
    last = {("s-normandie", "1"): LastPass("failed", _ago(days))}
    candidates = [c for c in _plan([NORMANDIE], last) if c.phase == "1"]

    assert bool(candidates) is due
    if due:
        assert candidates[0].reason == REASON_RETRY_AFTER_FAILURE


def test_une_decouverte_en_attente_bloque_la_phase_1_seulement():
    candidates = _plan([NORMANDIE], discovery_pending={"s-normandie"})
    assert _slots(candidates) == [("Em Normandie", "2")]


def test_une_ecole_sans_programme_n_est_jamais_candidate_en_phase_2():
    old = {("s-emlv", "2"): LastPass("completed", _ago(400))}
    assert _slots(_plan([EMLV], old)) == [("EMLV", "1")]


def test_une_ecole_occupee_ou_inactive_n_est_pas_candidate():
    busy = SchoolState("s-lyon", "Em Lyon", "ACTIVE", 24, 14, has_active_job=True)
    inactive = SchoolState("s-x", "École fermée", "INACTIVE", 3, 3)
    assert _plan([busy, inactive]) == []


# --- L'ordre ---------------------------------------------------------------------

def test_l_ordre_de_priorite():
    last = {
        # Em Lyon : cartographiée avant la rotation — son job de Phase 1, purgé
        # à 7 jours, n'existe plus ; enrichie il y a longtemps.
        ("s-lyon", "2"): LastPass("completed", _ago(200)),
        # EM Strasbourg : cartographiée et enrichie, la Phase 2 a échoué.
        ("s-strasbourg", "1"): LastPass("completed", _ago(250)),
        ("s-strasbourg", "2"): LastPass("failed", _ago(20)),
        # Em Normandie : découverte validée, jamais enrichie.
        ("s-normandie", "1"): LastPass("completed", _ago(30)),
    }
    candidates = _plan([STRASBOURG, NORMANDIE, ESSEC, LYON, EMLV], last)

    assert _slots(candidates) == [
        # 1. Phase 1 des écoles sans Program, par nom
        ("EMLV", "1"),
        ("Essec", "1"),
        # 2. Phase 2 jamais passée — devant la Phase 1 jamais passée d'Em Lyon,
        #    dont le nom précède pourtant
        ("Em Normandie", "2"),
        # 3. les autres, du plus ancien passage au plus récent
        ("Em Lyon", "1"),         # jamais
        ("EM Strasbourg", "1"),   # 250 jours
        ("Em Lyon", "2"),         # 200 jours
        ("EM Strasbourg", "2"),   # échec il y a 20 jours
    ]


def test_a_egalite_le_nom_departage():
    same_day = _ago(200)
    last = {
        ("s-lyon", "2"): LastPass("completed", same_day),
        ("s-normandie", "2"): LastPass("completed", same_day),
        ("s-lyon", "1"): LastPass("completed", _ago(10)),
        ("s-normandie", "1"): LastPass("completed", _ago(10)),
    }
    assert _slots(_plan([NORMANDIE, LYON], last)) == [("Em Lyon", "2"), ("Em Normandie", "2")]


# --- Le coût ---------------------------------------------------------------------

def test_cout_estime():
    assert estimate_phase2_credits(15, 30) == 720
    assert PHASE1_ESTIMATED_CREDITS == 30
    by_slot = {(c.school_name, c.phase): c.estimated_credits for c in _plan([NORMANDIE, LYON])}
    assert by_slot == {
        ("Em Normandie", "1"): 30,
        ("Em Normandie", "2"): 720,
        ("Em Lyon", "1"): 30,
        ("Em Lyon", "2"): 45 + 25 * 24 + 10 * 14,
    }


# --- Le dernier passage, lu dans PipelineJob -------------------------------------

class FakeCursor:
    """Applique aux lignes les filtres que les paramètres de la requête portent."""

    def __init__(self, rows):
        self.rows = rows
        self.statements = []
        self._result = []

    def execute(self, sql, params=()):
        self.statements.append((" ".join(sql.split()), params))
        school_ids, labels, statuses = params
        self._result = [
            row for row in self.rows
            if row["schoolId"] in school_ids
            and row["phase"] in labels
            and row["status"] in statuses
            and row["finished_at"] is not None
        ]

    def fetchall(self):
        return list(self._result)


def _job(school_id, phase, status, finished_at):
    return {"schoolId": school_id, "phase": phase, "status": status, "finished_at": finished_at}


def test_le_dernier_passage_complet_par_ecole_et_par_phase():
    naive = lambda days: _ago(days).replace(tzinfo=None)  # TIMESTAMP sans fuseau, comme en base
    cur = FakeCursor([
        _job("s-normandie", pipeline_jobs.PHASE1_LABEL, "completed", naive(90)),
        _job("s-normandie", pipeline_jobs.PHASE1_CRON_LABEL, "failed", naive(20)),
        _job("s-normandie", pipeline_jobs.PHASE2_CRON_LABEL, "completed", naive(100)),
        _job("s-normandie", pipeline_jobs.PHASE2_LABEL, "running", None),
        _job("s-lyon", pipeline_jobs.PHASE2_LABEL, "completed", naive(50)),
    ])
    passes = pipeline_jobs.read_last_passes(cur, ["s-normandie", "s-lyon"])

    assert passes == {
        ("s-normandie", "1"): LastPass("failed", _ago(20)),
        ("s-normandie", "2"): LastPass("completed", _ago(100)),
        ("s-lyon", "2"): LastPass("completed", _ago(50)),
    }


def test_l_enrichissement_cible_ne_compte_pas_comme_passage():
    cur = FakeCursor([
        _job("s-normandie", pipeline_jobs.PHASE2_CRON_LABEL, "completed", _ago(200)),
        _job("s-normandie", pipeline_jobs.PHASE2_TARGETED_LABEL, "completed", _ago(3)),
    ])
    passes = pipeline_jobs.read_last_passes(cur, ["s-normandie"])

    assert passes == {("s-normandie", "2"): LastPass("completed", _ago(200))}
    assert pipeline_jobs.PHASE2_TARGETED_LABEL not in pipeline_jobs.ROTATION_LABELS
    assert [c.phase for c in _plan([NORMANDIE], passes) if c.phase == "2"] == ["2"]


def test_aucune_ecole_aucune_requete():
    cur = FakeCursor([])
    assert pipeline_jobs.read_last_passes(cur, []) == {}
    assert read_discovery_pending(cur, []) == set()
    assert cur.statements == []


# --- La purge garde la mémoire ---------------------------------------------------

class RecordingDB:
    def __init__(self):
        self.statements = []

    @contextmanager
    def connection(self):
        yield self

    def cursor(self, cursor_factory=None):
        db = self

        class Cursor:
            rowcount = 0

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(self, sql, params=()):
                db.statements.append((" ".join(sql.split()), params))

        return Cursor()


def test_la_purge_garde_les_passages_complets_plus_longtemps():
    db = RecordingDB()
    with patch("backend.db.get_db_connection", db.connection):
        pipeline_jobs.purge_finished_jobs()

    [(sql, params)] = db.statements
    assert sql.startswith('DELETE FROM "PipelineJob"')
    assert "CASE WHEN phase = ANY(%s) THEN %s ELSE %s END * interval '1 day'" in sql
    active, rotation_labels, rotation_days, other_days = params
    assert (rotation_days, other_days) == (400, 7)

    def deleted(phase: str, status: str, age_days: int) -> bool:
        kept_for = rotation_days if phase in rotation_labels else other_days
        return status not in active and age_days > kept_for

    assert not deleted(pipeline_jobs.PHASE2_CRON_LABEL, "completed", 30)
    assert not deleted(pipeline_jobs.PHASE1_LABEL, "failed", 30)
    assert deleted(pipeline_jobs.PHASE2_TARGETED_LABEL, "completed", 30)
    assert deleted(pipeline_jobs.PHASE1_CRON_LABEL, "completed", 401)
    assert not deleted(pipeline_jobs.PHASE2_TARGETED_LABEL, "running", 30)


# --- La lecture d'état --------------------------------------------------------

class StateCursor:
    def __init__(self):
        self.statements = []
        self._rows = []

    def execute(self, sql, params=()):
        sql = " ".join(sql.split())
        self.statements.append((sql, params))
        if 'FROM "School"' in sql:
            self._rows = [
                {"id": "s-emlv", "name": "EMLV", "status": "ACTIVE",
                 "program_count": 0, "program_campus_count": 0, "has_active_job": False},
                {"id": "s-normandie", "name": "Em Normandie", "status": "ACTIVE",
                 "program_count": 15, "program_campus_count": 30, "has_active_job": True},
            ]
        elif 'FROM "PipelineJob"' in sql:
            self._rows = [_job("s-normandie", pipeline_jobs.PHASE1_LABEL, "completed", _ago(30))]
        elif 'FROM "ContributionInbox"' in sql:
            self._rows = [{"schoolId": "s-emlv"}]
        else:
            self._rows = []

    def fetchall(self):
        return list(self._rows)


def test_load_rotation_state():
    cur = StateCursor()
    state = rotation.load_rotation_state(cur)

    assert [s.name for s in state.schools] == ["EMLV", "Em Normandie"]
    assert state.schools[1] == SchoolState("s-normandie", "Em Normandie", "ACTIVE", 15, 30, True)
    assert state.last_passes == {("s-normandie", "1"): LastPass("completed", _ago(30))}
    assert state.discovery_pending == {"s-emlv"}

    school_sql, school_params = cur.statements[0]
    assert school_params == (list(pipeline_jobs.ACTIVE_STATUSES), "ACTIVE")
    inbox_sql, inbox_params = cur.statements[2]
    assert inbox_params == (["s-emlv", "s-normandie"], "Pending_Admin", "Automated_AI", "Program_Discovery")
    assert "ai_extracted_json ? 'discovered_campuses'" in inbox_sql

    # EMLV : découverte en attente, pas de Program ; Em Normandie : job actif.
    assert plan_rotation(state.schools, state.last_passes, state.discovery_pending, NOW, CONFIG) == []


# --- Réglages ----------------------------------------------------------------------

@pytest.mark.parametrize("raw, expected", [("", 182), ("200", 200), ("six mois", 182), ("0", 182)])
def test_un_reglage_illisible_retombe_sur_le_defaut(monkeypatch, caplog, raw, expected):
    monkeypatch.setenv("CRON_RESEARCH_INTERVAL_DAYS", raw)
    with caplog.at_level(logging.WARNING, logger="pipeline.config"):
        assert env_int("CRON_RESEARCH_INTERVAL_DAYS", 182, minimum=1) == expected
    assert bool(caplog.records) is (raw in ("six mois", "0"))
