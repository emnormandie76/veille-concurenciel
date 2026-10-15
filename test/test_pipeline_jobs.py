"""
La mémoire des jobs du pipeline (backend/pipeline_jobs.py).

`PipelineJob` est la mémoire du dernier passage d'une école : une erreur ici
fait repayer une école, ou ne plus jamais la repasser. Plan backend-local,
étape 7 (P0) : un seul job actif par école, `reap_orphaned_jobs` (autre
`worker_id`), `reap_stale_jobs` au seuil, `finished_at` lu en UTC,
`update_progress` qui avale l'erreur mais la journalise.

La purge à deux rétentions et `read_last_passes` sont tenues par
test/test_rotation_plan.py ; elles ne sont pas refaites ici.

Ni base ni réseau : `JobTable` joue la table, en appliquant aux lignes les
prédicats que portent les paramètres de chaque requête. Une requête qu'elle ne
reconnaît pas fait échouer le test.
"""

import json
import logging
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest

from backend import pipeline_jobs

NOW = datetime(2026, 10, 14, 9, 0, 0)  # TIMESTAMP sans fuseau, comme now() sur Neon
OTHER_WORKER = "autre-poste:4242:deadbeef"


def _job(job_id, school_id, status, *, worker=None, updated_ago=0, finished=None, started_ago=0):
    return {
        "id": job_id, "schoolId": school_id, "phase": pipeline_jobs.PHASE1_LABEL,
        "source": "manual", "status": status, "worker_id": worker,
        "progress": None, "result": None, "error": None,
        "started_at": NOW - timedelta(seconds=started_ago),
        "updated_at": NOW - timedelta(seconds=updated_ago),
        "finished_at": finished,
    }


class JobTable:
    """La table PipelineJob, et les requêtes de backend/pipeline_jobs.py."""

    def __init__(self, rows=()):
        self.rows = [dict(r) for r in rows]
        self.statements = []

    @contextmanager
    def connection(self):
        yield self

    def cursor(self, cursor_factory=None):
        return _Cursor(self)

    def by_id(self, job_id):
        return next(r for r in self.rows if r["id"] == job_id)


class _Cursor:
    def __init__(self, table):
        self.table = table
        self.rowcount = 0
        self._result = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def fetchone(self):
        return self._result[0] if self._result else None

    def fetchall(self):
        return list(self._result)

    def execute(self, sql, params=()):
        sql = " ".join(sql.split())
        self.table.statements.append((sql, params))
        rows = self.table.rows

        if sql.startswith('INSERT INTO "PipelineJob"'):
            job_id, school_id, phase, source, status, worker, progress = params
            rows.append({
                "id": job_id, "schoolId": school_id, "phase": phase, "source": source,
                "status": status, "worker_id": worker,
                "progress": json.loads(progress) if progress else None,
                "result": None, "error": None,
                "started_at": NOW, "updated_at": NOW, "finished_at": None,
            })
            self.rowcount = 1
        elif sql.startswith('UPDATE "PipelineJob" SET status = %s, worker_id = %s'):
            status, worker, job_id = params
            self.table.by_id(job_id).update(status=status, worker_id=worker, updated_at=NOW)
        elif sql.startswith('UPDATE "PipelineJob" SET progress = %s::jsonb'):
            progress, job_id = params
            self.table.by_id(job_id).update(progress=json.loads(progress), updated_at=NOW)
        elif sql.startswith('UPDATE "PipelineJob" SET status = %s, result = %s::jsonb'):
            status, result, error, job_id = params
            self.table.by_id(job_id).update(
                status=status, result=json.loads(result) if result else None, error=error,
                progress=None, updated_at=NOW, finished_at=NOW,
            )
        elif "updated_at < now() - (%s * interval '1 second')" in sql:
            status, error, active, seconds = params
            hit = [r for r in rows
                   if r["status"] in active and r["updated_at"] < NOW - timedelta(seconds=seconds)]
            for r in hit:
                r.update(status=status, error=error, updated_at=NOW, finished_at=NOW)
            self.rowcount = len(hit)
        elif "AND (worker_id IS NULL OR worker_id <> %s)" in sql:
            status, error, active, worker = params
            hit = [r for r in rows
                   if r["status"] in active and (r["worker_id"] is None or r["worker_id"] != worker)]
            for r in hit:
                r.update(status=status, error=error, updated_at=NOW, finished_at=NOW)
            self.rowcount = len(hit)
        elif sql.startswith("SELECT") and 'WHERE "schoolId" = %s AND status = ANY(%s)' in sql:
            assert sql.endswith("ORDER BY started_at ASC LIMIT 1")
            school_id, active = params
            self._result = sorted(
                (r for r in rows if r["schoolId"] == school_id and r["status"] in active),
                key=lambda r: r["started_at"],
            )[:1]
        else:
            raise AssertionError(f"requête inattendue : {sql}")


@pytest.fixture
def table(monkeypatch):
    def install(rows=()):
        db = JobTable(rows)
        monkeypatch.setattr("backend.db.get_db_connection", db.connection)
        return db
    return install


# ── Un seul job actif par école ──────────────────────────────────────

def test_get_active_job_rend_le_job_actif_de_l_ecole(table):
    db = table([
        _job("j-ancien", "s-normandie", "running", started_ago=600),
        _job("j-recent", "s-normandie", "queued", started_ago=60),
        _job("j-lyon", "s-lyon", "running", started_ago=900),
        _job("j-fini", "s-normandie", "completed", started_ago=3000, finished=NOW),
    ])

    active = pipeline_jobs.get_active_job("s-normandie")

    assert active["job_id"] == "j-ancien"
    assert active["school_id"] == "s-normandie"
    assert active["status"] == "running"
    assert pipeline_jobs.get_active_job("s-essec") is None
    # Les morts sont clos AVANT la lecture, à chaque fois.
    kinds = ["reap" if "interval '1 second'" in sql else "select" for sql, _ in db.statements]
    assert kinds == ["reap", "select", "reap", "select"]


def test_un_job_mort_ne_verrouille_pas_l_ecole(table):
    """Sans signe de vie depuis plus que le seuil : clos, l'école est libre."""
    db = table([
        _job("j-mort", "s-normandie", "running",
             worker=pipeline_jobs.WORKER_ID, updated_ago=pipeline_jobs.STALE_AFTER_SECONDS + 1),
    ])

    assert pipeline_jobs.get_active_job("s-normandie") is None
    assert db.by_id("j-mort")["status"] == "failed"


def test_create_job_puis_cycle_de_vie(table):
    db = table()

    job_id = pipeline_jobs.create_job("s-normandie", pipeline_jobs.PHASE1_LABEL, progress={"current_action": "File"})
    row = db.by_id(job_id)
    assert (row["status"], row["worker_id"], row["source"]) == ("queued", pipeline_jobs.WORKER_ID, "manual")
    assert row["progress"] == {"current_action": "File"}
    assert pipeline_jobs.get_active_job("s-normandie")["job_id"] == job_id

    pipeline_jobs.mark_running(job_id)
    assert db.by_id(job_id)["status"] == "running"

    pipeline_jobs.complete_job(job_id, pipeline_jobs.STATUS_FAILED, result={"success": False}, error="x" * 5000)
    row = db.by_id(job_id)
    assert row["status"] == "failed"
    assert row["finished_at"] == NOW
    assert row["progress"] is None
    assert row["result"] == {"success": False}
    assert len(row["error"]) == 2000  # borné à l'écriture
    assert pipeline_jobs.get_active_job("s-normandie") is None


def test_un_job_sans_progression_initiale_n_ecrit_pas_de_json(table):
    db = table()
    job_id = pipeline_jobs.create_job("s-normandie", pipeline_jobs.PHASE2_LABEL)

    insert_params = db.statements[0][1]
    assert insert_params[-1] is None
    assert db.by_id(job_id)["progress"] is None


# ── Jobs orphelins : un autre processus ──────────────────────────────

def test_reap_orphaned_jobs_clot_les_jobs_d_un_autre_worker(table):
    db = table([
        _job("j-autre", "s-normandie", "running", worker=OTHER_WORKER),
        _job("j-sans-worker", "s-lyon", "queued", worker=None),
        _job("j-moi", "s-essec", "running", worker=pipeline_jobs.WORKER_ID),
        _job("j-fini", "s-neoma", "completed", worker=OTHER_WORKER, finished=NOW),
    ])

    assert pipeline_jobs.reap_orphaned_jobs() == 2

    assert db.by_id("j-autre")["status"] == "failed"
    assert db.by_id("j-sans-worker")["status"] == "failed"
    assert "processus qui le portait s'est arrêté" in db.by_id("j-autre")["error"]
    assert db.by_id("j-autre")["finished_at"] == NOW
    assert db.by_id("j-moi")["status"] == "running"
    assert db.by_id("j-fini")["status"] == "completed"


def test_mark_running_reprend_la_propriete_du_processus(table):
    db = table([_job("j-repris", "s-normandie", "queued", worker=OTHER_WORKER)])

    pipeline_jobs.mark_running("j-repris")

    assert db.by_id("j-repris")["worker_id"] == pipeline_jobs.WORKER_ID
    assert pipeline_jobs.reap_orphaned_jobs() == 0


# ── Jobs morts : au seuil ────────────────────────────────────────────

def test_reap_stale_jobs_au_seuil(table):
    seuil = pipeline_jobs.STALE_AFTER_SECONDS
    db = table([
        _job("j-au-seuil", "s-1", "running", updated_ago=seuil),
        _job("j-juste-avant", "s-2", "running", updated_ago=seuil - 1),
        _job("j-juste-apres", "s-3", "queued", updated_ago=seuil + 1),
        _job("j-fini-ancien", "s-4", "completed", updated_ago=seuil * 10, finished=NOW),
    ])

    assert pipeline_jobs.reap_stale_jobs() == 1

    assert db.by_id("j-au-seuil")["status"] == "running"
    assert db.by_id("j-juste-avant")["status"] == "running"
    assert db.by_id("j-juste-apres")["status"] == "failed"
    assert "aucun signe de vie" in db.by_id("j-juste-apres")["error"]
    assert db.by_id("j-fini-ancien")["status"] == "completed"
    _sql, params = db.statements[0]
    assert params[2] == list(pipeline_jobs.ACTIVE_STATUSES)
    assert params[3] == seuil


def test_le_seuil_couvre_un_research_pro():
    """Un Research « pro » peut attendre 600 s sans progression."""
    assert pipeline_jobs.STALE_AFTER_SECONDS > 600


def test_une_progression_repousse_le_seuil(table):
    seuil = pipeline_jobs.STALE_AFTER_SECONDS
    db = table([_job("j-vivant", "s-1", "running", updated_ago=seuil + 60)])

    pipeline_jobs.update_progress("j-vivant", {"current_action": "Extraction"})

    assert pipeline_jobs.reap_stale_jobs() == 0
    assert db.by_id("j-vivant")["progress"] == {"current_action": "Extraction"}


# ── update_progress : best effort, mais journalisé ───────────────────

def test_update_progress_avale_l_erreur_mais_la_journalise(monkeypatch, caplog):
    @contextmanager
    def unreachable():
        raise RuntimeError("Connexion PostgreSQL impossible (pilote : neon-ws)")
        yield  # pragma: no cover

    monkeypatch.setattr("backend.db.get_db_connection", unreachable)

    with caplog.at_level(logging.WARNING, logger="pipeline.jobs_store"):
        pipeline_jobs.update_progress("j-42", {"current_action": "Research"})

    [record] = caplog.records
    assert "j-42" in record.getMessage()
    assert "Connexion PostgreSQL impossible" in record.getMessage()


def test_les_autres_ecritures_ne_sont_pas_avalees(monkeypatch):
    """Créer ou clore un job qui échoue doit remonter : la mémoire en dépend."""
    @contextmanager
    def unreachable():
        raise RuntimeError("base injoignable")
        yield  # pragma: no cover

    monkeypatch.setattr("backend.db.get_db_connection", unreachable)

    with pytest.raises(RuntimeError):
        pipeline_jobs.create_job("s-1", pipeline_jobs.PHASE1_LABEL)
    with pytest.raises(RuntimeError):
        pipeline_jobs.complete_job("j-1", pipeline_jobs.STATUS_COMPLETED)


# ── finished_at lu en UTC ────────────────────────────────────────────

def test_finished_at_sans_fuseau_est_lu_en_utc():
    naive = datetime(2026, 4, 14, 23, 30)
    assert pipeline_jobs._as_utc(naive) == datetime(2026, 4, 14, 23, 30, tzinfo=timezone.utc)


def test_un_instant_avec_fuseau_est_garde_tel_quel():
    paris = timezone(timedelta(hours=2))
    aware = datetime(2026, 4, 15, 1, 30, tzinfo=paris)

    assert pipeline_jobs._as_utc(aware) is aware
    assert pipeline_jobs._as_utc(aware) == datetime(2026, 4, 14, 23, 30, tzinfo=timezone.utc)


def test_row_to_job_forme_de_l_api():
    row = _job("j-1", "s-1", "completed", started_ago=60, finished=NOW)
    row["progress"] = {"progress": "2/3"}

    assert pipeline_jobs._row_to_job(row) == {
        "job_id": "j-1",
        "school_id": "s-1",
        "phase": pipeline_jobs.PHASE1_LABEL,
        "source": "manual",
        "status": "completed",
        "progress_details": {"progress": "2/3"},
        "result": None,
        "error": None,
        "created_at": "2026-10-14T08:59:00",
        "updated_at": "2026-10-14T09:00:00",
        "finished_at": "2026-10-14T09:00:00",
    }
    assert pipeline_jobs._row_to_job(None) is None
