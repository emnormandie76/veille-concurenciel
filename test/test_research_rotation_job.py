"""
Les passes dues, lancées à la demande : `run_due_passes`.

Il remplace le cron nocturne `research_rotation` sans en changer la logique.
Ces tests tiennent :
- le plafond mensuel, le battement de cœur des passes, les drapeaux passés aux
  phases, et l'arrêt sur un quota épuisé, y compris quand la phase avale
  l'exception (ce que font les deux) ;
- `max_passes`, et `dry_run`, qui planifie sans créer de job ni appeler
  Research ;
- le verrou : une seconde exécution réelle simultanée est refusée
  (`RotationAlreadyRunning`) ;
- la synchro `/usage` d'abord : si une clé n'a pas pu être recalée, rien ne
  part (`UsageSyncFailed`, F8) ;
- le rapport rendu, et toujours inscrit au registre.

Ni base, ni réseau, ni Tavily : planificateur, phases et table PipelineJob sont
des doubles. Voir backend/scheduler/jobs.py et
docs/features/backend-local.md, étape 3.
"""

import logging
import threading
from contextlib import contextmanager
from unittest.mock import MagicMock

import pytest

from backend import pipeline_jobs
from backend.pipeline import phase1_research, phase2_research
from backend.scheduler import jobs, rotation
from backend.scheduler.rotation import Candidate, RotationState
from backend.tavily_service.key_manager import QuotaExhaustedError

NORMANDIE_P2 = Candidate("s-normandie", "Em Normandie", "2", "never", None, 720)
LYON_P2 = Candidate("s-lyon", "Em Lyon", "2", "interval", None, 785)
ESSEC_P1 = Candidate("s-essec", "Essec", "1", "never", None, 30)

SYNC_AT = "2026-10-14T08:00:00+00:00"


class FakeKeys:
    """Le TavilyKeyManager, réduit à ce que le job et les phases lui demandent."""

    def __init__(self, used=0, available=3, refuse=False, sync_ok=True, used_after_sync=None):
        self.used = used
        self.available_keys = available
        self.refuse = refuse
        self.sync_ok = sync_ok
        self.used_after_sync = used_after_sync
        self.syncs = 0
        self.last_sync = None

    def sync_usage(self, timeout=20):
        self.syncs += 1
        if self.used_after_sync is not None:
            self.used = self.used_after_sync
        self.last_sync = {
            "ok": self.sync_ok,
            "at": SYNC_AT,
            "failed_keys": [] if self.sync_ok else ["...bbb222"],
        }
        return dict(self.last_sync)

    def credits_used_this_month(self):
        return self.used

    def get_active_key(self, required_credits=50):
        if self.refuse:
            raise QuotaExhaustedError("Toutes les clés Tavily sont insuffisantes")
        return "tvly-key"


class Run:
    """Une exécution de `run_due_passes`, tout ce qui coûte ou écrit étant remplacé."""

    def __init__(self, monkeypatch, candidates, *, ceiling=7000, passes=1,
                 phase1=None, phase2=None, busy=(), job_ids=True):
        self.candidates = candidates
        self.passes = passes
        self.finished: list[tuple] = []
        self.records: list[tuple] = []
        self.started: list[tuple] = []
        self.planned: list[dict] = []
        self.report = None
        self.phase1 = MagicMock(side_effect=phase1 or (lambda *a, **k: {"success": True, "message": "ok"}))
        self.phase2 = MagicMock(side_effect=phase2 or (lambda *a, **k: {"success": True, "message": "ok"}))
        self.progress = MagicMock()
        self.reap = MagicMock(return_value=0)

        def start(school_id, phase):
            self.started.append((school_id, phase))
            return f"job-{len(self.started)}" if job_ids else None

        @contextmanager
        def connection():
            yield MagicMock()

        monkeypatch.setattr(jobs, "MONTHLY_CREDIT_CEILING", ceiling)
        monkeypatch.setattr("backend.db.get_db_connection", connection)
        monkeypatch.setattr(pipeline_jobs, "reap_stale_jobs", self.reap)
        monkeypatch.setattr(pipeline_jobs, "update_progress", self.progress)
        monkeypatch.setattr(rotation, "load_rotation_state", MagicMock(return_value=RotationState()))
        monkeypatch.setattr(rotation, "plan_rotation", MagicMock(return_value=candidates))
        monkeypatch.setattr(jobs, "_school_is_busy", lambda school_id: school_id in busy)
        monkeypatch.setattr(jobs, "_start_rotation_job", start)
        monkeypatch.setattr(
            jobs, "_finish_rotation_job",
            lambda job_id, status, result=None, error=None: self.finished.append((job_id, status, error)),
        )
        monkeypatch.setattr(jobs, "_record_job_run", lambda *args: self.records.append(args))
        monkeypatch.setattr(phase1_research, "run_phase1_research", self.phase1)
        monkeypatch.setattr(phase2_research, "run_phase2_research", self.phase2)

    def run(self, keys, **kwargs):
        kwargs.setdefault("max_passes", self.passes)
        self.report = jobs.run_due_passes(keys, on_planned=self.planned.append, **kwargs)
        return self

    def recorded(self, job_id=jobs.ROTATION_JOB_ID):
        return [(status, detail) for record_id, status, detail in self.records if record_id == job_id]

    @property
    def record(self):
        [(job_id, status, detail)] = self.records
        assert job_id == jobs.ROTATION_JOB_ID
        return status, detail


def _names(entries):
    return [(entry["school_name"], entry["phase"]) for entry in entries]


# --- Le plafond ------------------------------------------------------------------

def test_un_candidat_trop_cher_est_saute_pour_le_suivant_qui_tient(monkeypatch):
    run = Run(monkeypatch, [NORMANDIE_P2, ESSEC_P1]).run(FakeKeys(used=6900))

    run.phase2.assert_not_called()
    assert run.phase1.call_args.args[0] == "s-essec"
    assert run.started == [("s-essec", pipeline_jobs.PHASE1_CRON_LABEL)]
    assert run.finished == [("job-1", "completed", None)]
    assert run.record == ("success", "Essec, Phase 1, ~30 crédits")
    assert run.report["status"] == "success"
    assert [(e["school_name"], e["status"]) for e in run.report["launched"]] == [("Essec", "completed")]


def test_plafond_atteint_rien_ne_part(monkeypatch, caplog):
    run = Run(monkeypatch, [NORMANDIE_P2, ESSEC_P1], ceiling=0)
    with caplog.at_level(logging.INFO, logger="pipeline.scheduler"):
        run.run(FakeKeys(used=0))

    run.phase1.assert_not_called()
    run.phase2.assert_not_called()
    assert run.started == []
    status, detail = run.record
    assert status == "success"
    assert detail.startswith("plafond mensuel atteint : 0/0 crédits, 2 passe(s) en attente")
    assert run.report["planned"] == []
    plan_line = next(r.getMessage() for r in caplog.records if "passe(s) due(s)" in r.getMessage())
    assert "Em Normandie, Phase 2, ~720 crédits (never)" in plan_line
    assert "Essec, Phase 1, ~30 crédits (never)" in plan_line


def test_les_credits_relus_apres_la_synchro_decident(monkeypatch):
    """La synchro passe avant la planification : le plafond voit les vrais crédits."""
    keys = FakeKeys(used=0, used_after_sync=6900)
    run = Run(monkeypatch, [NORMANDIE_P2, ESSEC_P1]).run(keys)

    assert keys.syncs == 1
    assert run.started == [("s-essec", pipeline_jobs.PHASE1_CRON_LABEL)]
    assert run.report["month_credits_used"] == 6900


# --- max_passes ------------------------------------------------------------------------

def test_une_passe_par_defaut(monkeypatch):
    run = Run(monkeypatch, [NORMANDIE_P2, LYON_P2, ESSEC_P1])
    run.report = jobs.run_due_passes(FakeKeys())

    assert run.started == [("s-normandie", pipeline_jobs.PHASE2_CRON_LABEL)]
    run.phase1.assert_not_called()


def test_max_passes_est_respecte(monkeypatch):
    run = Run(monkeypatch, [NORMANDIE_P2, LYON_P2, ESSEC_P1], passes=2).run(FakeKeys())

    assert run.started == [
        ("s-normandie", pipeline_jobs.PHASE2_CRON_LABEL),
        ("s-lyon", pipeline_jobs.PHASE2_CRON_LABEL),
    ]
    run.phase1.assert_not_called()
    assert run.report["max_passes"] == 2


@pytest.mark.parametrize("max_passes", [0, -1, jobs.MAX_PASSES_PER_RUN + 1])
def test_max_passes_hors_bornes_est_refuse(monkeypatch, max_passes):
    run = Run(monkeypatch, [ESSEC_P1])
    keys = FakeKeys()

    with pytest.raises(ValueError):
        jobs.run_due_passes(keys, max_passes=max_passes)
    assert keys.syncs == 0
    assert run.started == []


# --- Le plan annoncé avant le départ ------------------------------------------------------

def test_le_plan_est_annonce_avant_la_premiere_passe(monkeypatch):
    seen_at_launch = []

    def phase1(*args, **kwargs):
        seen_at_launch.append(list(run.planned))
        return {"success": True, "message": "ok"}

    run = Run(monkeypatch, [NORMANDIE_P2, ESSEC_P1], phase1=phase1)
    run.run(FakeKeys(used=6900))

    [snapshot] = run.planned
    assert snapshot["status"] == "planned"
    assert snapshot["dry_run"] is False
    assert _names(snapshot["planned"]) == [("Essec", "1")]
    assert snapshot["launched"] == []
    assert seen_at_launch == [[snapshot]]


# --- dry_run --------------------------------------------------------------------------------

def test_dry_run_planifie_sans_job_ni_research(monkeypatch):
    keys = FakeKeys(used=6900)
    run = Run(monkeypatch, [NORMANDIE_P2, LYON_P2, ESSEC_P1], passes=3).run(keys, dry_run=True)

    run.phase1.assert_not_called()
    run.phase2.assert_not_called()
    assert run.started == []
    assert run.finished == []
    assert keys.syncs == 0, "une simulation ne part pas sur le réseau"
    report = run.report
    assert report["dry_run"] is True
    assert report["status"] == "success"
    assert report["due_count"] == 3
    assert _names(report["planned"]) == [("Essec", "1")]
    assert report["launched"] == []
    # Inscrite à part : une simulation n'efface pas l'issue de la dernière exécution réelle.
    assert run.recorded(jobs.ROTATION_JOB_ID) == []
    [(status, detail)] = run.recorded(jobs.DRY_RUN_JOB_ID)
    assert status == "success"
    assert detail.startswith("simulation")


def test_dry_run_compte_chaque_passe_retenue_contre_le_plafond(monkeypatch):
    """Deux passes à 720 et 785 sous un plafond de 1 000 : seule la première tiendrait."""
    run = Run(monkeypatch, [NORMANDIE_P2, LYON_P2, ESSEC_P1], ceiling=1000, passes=3)
    run.run(FakeKeys(used=0), dry_run=True)

    assert _names(run.report["planned"]) == [("Em Normandie", "2"), ("Essec", "1")]


# --- La passe ----------------------------------------------------------------------

def test_le_battement_de_coeur_met_a_jour_le_job(monkeypatch):
    def phase2(school_id, key_manager, **kwargs):
        kwargs["progress_callback"]({"current_action": "Recherche Pricing", "progress": "4/48"})
        return {"success": True, "message": "3 ticket(s)"}

    run = Run(monkeypatch, [NORMANDIE_P2], phase2=phase2).run(FakeKeys())

    run.progress.assert_called_once_with(
        "job-1", {"current_action": "Recherche Pricing", "progress": "4/48"}
    )


def test_drapeaux_des_phases(monkeypatch):
    run = Run(monkeypatch, [NORMANDIE_P2, ESSEC_P1], passes=2).run(FakeKeys())

    assert run.phase2.call_args.kwargs["skip_pending"] is True
    assert run.phase1.call_args.kwargs["collect_campus_attachments"] is False
    assert [status for _, status, _ in run.finished] == ["completed", "completed"]
    assert run.record[0] == "success"


def test_les_jobs_morts_sont_clos_avant_de_planifier(monkeypatch):
    run = Run(monkeypatch, [ESSEC_P1]).run(FakeKeys())
    run.reap.assert_called_once_with()


def test_une_ecole_occupee_laisse_la_place_au_candidat_suivant(monkeypatch):
    run = Run(monkeypatch, [NORMANDIE_P2, ESSEC_P1], busy={"s-normandie"}).run(FakeKeys())

    assert run.started == [("s-essec", pipeline_jobs.PHASE1_CRON_LABEL)]


def test_un_echec_de_phase_clot_le_job_en_failed(monkeypatch):
    run = Run(
        monkeypatch, [ESSEC_P1],
        phase1=lambda *a, **k: {"success": False, "message": "le rapport ne nomme aucun campus"},
    ).run(FakeKeys())

    assert run.finished == [("job-1", "failed", "le rapport ne nomme aucun campus")]
    assert run.record == ("failed", "Essec, Phase 1, ~30 crédits — le rapport ne nomme aucun campus")
    assert run.report["status"] == "failed"


def test_sans_job_en_base_la_passe_n_est_pas_lancee(monkeypatch):
    """Le job est la mémoire du passage : sans lui, l'école serait repayée au lancement suivant."""
    run = Run(monkeypatch, [NORMANDIE_P2, ESSEC_P1], passes=2, job_ids=False).run(FakeKeys())

    run.phase1.assert_not_called()
    run.phase2.assert_not_called()
    assert run.started == [("s-normandie", pipeline_jobs.PHASE2_CRON_LABEL)]
    assert run.record[0] == "failed"


# --- Le quota ------------------------------------------------------------------------

def test_quota_exhausted_error_clot_le_job_et_l_execution(monkeypatch):
    def phase2(*args, **kwargs):
        raise QuotaExhaustedError("Toutes les clés Tavily sont épuisées")

    run = Run(monkeypatch, [NORMANDIE_P2, LYON_P2, ESSEC_P1], passes=3, phase2=phase2).run(FakeKeys())

    assert run.started == [("s-normandie", pipeline_jobs.PHASE2_CRON_LABEL)]
    assert run.finished == [("job-1", "failed", "Toutes les clés Tavily sont épuisées")]
    run.phase1.assert_not_called()
    assert run.record[0] == "failed"


def test_un_refus_de_cle_avale_par_la_phase_clot_aussi_l_execution(monkeypatch):
    """
    La vraie Phase 2 : `_run_research_and_extract` attrape l'exception et passe à
    la cible suivante, puis la passe se termine « réussie ».
    """
    def phase2(school_id, key_manager, **kwargs):
        try:
            key_manager.get_active_key(required_credits=250)
        except QuotaExhaustedError:
            pass
        return {"success": True, "tickets_created": 0, "message": "0 ticket(s) créé(s) sur 48 scans"}

    run = Run(monkeypatch, [NORMANDIE_P2, ESSEC_P1], passes=2, phase2=phase2).run(FakeKeys(refuse=True))

    assert run.finished == [("job-1", "failed", jobs._QUOTA_CUT_ERROR)]
    run.phase1.assert_not_called()


def test_des_cles_toutes_epuisees_apres_la_passe_la_rendent_incomplete(monkeypatch):
    run = Run(monkeypatch, [NORMANDIE_P2, ESSEC_P1], passes=2).run(FakeKeys(available=0))

    assert run.finished == [("job-1", "failed", jobs._QUOTA_CUT_ERROR)]
    run.phase1.assert_not_called()


# --- La synchro /usage (F8) ------------------------------------------------------------

def test_synchro_usage_en_echec_rien_ne_part(monkeypatch):
    keys = FakeKeys(sync_ok=False)
    run = Run(monkeypatch, [ESSEC_P1])

    with pytest.raises(jobs.UsageSyncFailed) as caught:
        run.run(keys)

    assert caught.value.code == "USAGE_SYNC_FAILED"
    assert caught.value.usage_sync["failed_keys"] == ["...bbb222"]
    run.phase1.assert_not_called()
    assert run.started == []
    assert run.planned == [], "rien n'est annoncé"
    [(status, detail)] = run.recorded()
    assert status == "failed"
    assert "...bbb222" in detail

    # Le verrou est rendu : une exécution suivante part normalement.
    keys.sync_ok = True
    run.run(keys)
    assert run.started == [("s-essec", pipeline_jobs.PHASE1_CRON_LABEL)]


# --- Le verrou ------------------------------------------------------------------------

def test_une_seconde_execution_simultanee_est_refusee(monkeypatch):
    entered = threading.Event()
    release = threading.Event()

    def phase2(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return {"success": True, "message": "ok"}

    run = Run(monkeypatch, [NORMANDIE_P2], phase2=phase2)
    keys = FakeKeys()
    first = threading.Thread(target=run.run, args=(keys,))
    first.start()
    try:
        assert entered.wait(5)
        with pytest.raises(jobs.RotationAlreadyRunning):
            jobs.run_due_passes(keys)
        assert keys.syncs == 1, "l'exécution refusée ne synchronise rien"
        # Une simulation reste possible : elle n'écrit aucun job et ne paie rien.
        assert jobs.run_due_passes(keys, dry_run=True)["dry_run"] is True
    finally:
        release.set()
        first.join(5)

    assert not first.is_alive()
    assert run.started == [("s-normandie", pipeline_jobs.PHASE2_CRON_LABEL)]
    # Le verrou est rendu à la fin de la première exécution.
    run.run(keys)
    assert len(run.started) == 2


# --- Les cas vides ---------------------------------------------------------------------

def test_aucune_passe_due(monkeypatch):
    run = Run(monkeypatch, []).run(FakeKeys())
    assert run.record == ("success", "aucune passe due")
    assert run.started == []
    assert run.report["status"] == "success"


def test_sans_gestionnaire_de_cles_rien_ne_part(monkeypatch):
    run = Run(monkeypatch, [ESSEC_P1]).run(None)
    assert run.record[0] == "failed"
    assert run.started == []
    assert run.report["status"] == "failed"


def test_une_planification_impossible_est_un_echec_rendu(monkeypatch):
    run = Run(monkeypatch, [ESSEC_P1])
    monkeypatch.setattr(rotation, "load_rotation_state", MagicMock(side_effect=RuntimeError("Neon injoignable")))
    run.run(FakeKeys())

    assert run.started == []
    assert run.record == ("failed", "planification : Neon injoignable")
    assert run.report["status"] == "failed"
