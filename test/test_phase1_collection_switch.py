"""
L'interrupteur de la collecte du rattachement campus, de FastAPI au resultat du job.

La requete de l'ecran admin arrive sur POST /internal/trigger-targeted-research.
Ces tests suivent `collect_campus_attachments` jusqu'a `PipelineJob.result`,
dans les deux etats, puis verifient que les passes dues (`run_due_passes`) et
`trigger-scan` ne l'activent jamais. Ni base ni reseau : la table PipelineJob et
la decouverte sont des doubles, et le pas de collecte leve s'il est appele alors
qu'il ne devrait pas l'etre.
"""

import asyncio
import os
import sys
import types
import unittest
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import HTTPException  # noqa: E402

from backend.pipeline import phase1_research  # noqa: E402
from backend.routers import internal  # noqa: E402

CATALOG = "https://www.em-normandie.com/programmes"


def fake_discovery(school_id, key_manager, dry_run, progress_callback, context):
    """La decouverte, inchangee par l'interrupteur : elle n'est pas rejouee ici."""
    context.update({"school": {"name": "Em Normandie"}, "catalog_urls": [CATALOG]})
    return {"success": True, "message": "Ticket Program_Discovery créé", "inbox_id": "discovery-ticket"}


def forbidden_step():
    return MagicMock(side_effect=AssertionError("collecte lancee alors qu'elle est desactivee"))


class JobStore:
    """La table PipelineJob, en memoire."""

    def __init__(self):
        self.created = []
        self.completed = []

    def create_job(self, school_id, phase, source="manual", progress=None):
        self.created.append({"school_id": school_id, "phase": phase, "source": source, "progress": progress})
        return f"job-{len(self.created)}"

    def complete_job(self, job_id, status, result=None, error=None):
        self.completed.append({"job_id": job_id, "status": status, "result": result, "error": error})


@contextmanager
def backend_app():
    """`backend.main` sans son chargement d'environnement : seul le gestionnaire de cles compte."""
    fake_main = types.ModuleType("backend.main")
    fake_main.app = types.SimpleNamespace(state=types.SimpleNamespace(tavily_manager="key-manager"))
    with patch.dict(sys.modules, {"backend.main": fake_main}):
        yield


class TestTargetedResearchSwitch(unittest.TestCase):
    def setUp(self):
        self.store = JobStore()

    def trigger(self, **fields):
        spawned = []
        with patch.object(internal.pipeline_jobs, "get_active_job", return_value=None), \
             patch.object(internal.pipeline_jobs, "create_job", side_effect=self.store.create_job), \
             patch.object(internal, "_spawn", side_effect=spawned.append):
            response = asyncio.run(
                internal.trigger_targeted_research(
                    "s1", internal.TargetedResearchRequest(**fields), _token="t"
                )
            )
        return response, spawned

    def run_job(self, coro, step):
        with backend_app(), \
             patch.object(internal.pipeline_jobs, "mark_running"), \
             patch.object(internal.pipeline_jobs, "update_progress"), \
             patch.object(internal.pipeline_jobs, "complete_job", side_effect=self.store.complete_job), \
             patch.object(phase1_research, "_run_program_discovery", side_effect=fake_discovery), \
             patch.object(phase1_research, "_run_campus_attachment_step", step):
            asyncio.run(coro)
        self.assertEqual(len(self.store.completed), 1)
        return self.store.completed[0]

    def test_without_the_field_the_job_says_disabled(self):
        response, spawned = self.trigger(phase="1")
        self.assertIs(response["collect_campus_attachments"], False)
        self.assertIs(self.store.created[0]["progress"]["collect_campus_attachments"], False)

        step = forbidden_step()
        job = self.run_job(spawned[0], step)
        step.assert_not_called()
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["result"]["campus_attachments"], {"status": "disabled"})
        self.assertEqual(job["result"]["inbox_id"], "discovery-ticket")

    def test_unchecked_box_is_the_same_as_no_field(self):
        response, spawned = self.trigger(phase="1", collect_campus_attachments=False)
        self.assertIs(response["collect_campus_attachments"], False)
        step = forbidden_step()
        job = self.run_job(spawned[0], step)
        step.assert_not_called()
        self.assertEqual(job["result"]["campus_attachments"], {"status": "disabled"})

    def test_checked_box_runs_the_step_for_this_pass(self):
        response, spawned = self.trigger(phase="1", collect_campus_attachments=True)
        self.assertIs(response["collect_campus_attachments"], True)
        self.assertIs(self.store.created[0]["progress"]["collect_campus_attachments"], True)

        step = MagicMock(return_value={"status": "ticket_emitted", "ticket_id": "attachment-ticket"})
        job = self.run_job(spawned[0], step)
        step.assert_called_once()
        school_id, key_manager, context, _progress = step.call_args.args
        self.assertEqual((school_id, key_manager, context["catalog_urls"]), ("s1", "key-manager", [CATALOG]))
        self.assertEqual(job["result"]["campus_attachments"], {"status": "ticket_emitted", "ticket_id": "attachment-ticket"})
        self.assertEqual(job["result"]["inbox_id"], "discovery-ticket")

    def test_the_next_pass_is_off_again(self):
        """Aucune memoire : une passe activee n'active pas la suivante."""
        _, spawned = self.trigger(phase="1", collect_campus_attachments=True)
        spawned[0].close()
        _, spawned = self.trigger(phase="1")
        self.assertIs(self.store.created[1]["progress"]["collect_campus_attachments"], False)
        spawned[0].close()

    def test_refused_in_phase_2_before_any_job(self):
        with self.assertRaises(HTTPException) as caught:
            self.trigger(phase="2", collect_campus_attachments=True)
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(self.store.created, [])


class TestOtherEntryPointsNeverCollect(unittest.TestCase):
    def test_the_due_passes(self):
        from backend.scheduler import jobs
        from backend.scheduler.rotation import Candidate

        candidate = Candidate("s1", "Nouvelle école", "1", "never", None, 30)
        finished = []
        step = forbidden_step()
        with patch.object(jobs, "_school_is_busy", return_value=False),              patch.object(jobs, "_start_rotation_job", return_value="rotation-job"),              patch.object(jobs, "_finish_rotation_job",
                          side_effect=lambda job_id, status, result=None, error=None: finished.append((status, result))),              patch.object(phase1_research, "_run_program_discovery", side_effect=fake_discovery),              patch.object(phase1_research, "_run_campus_attachment_step", step):
            jobs._run_rotation_pass(candidate, MagicMock(available_keys=3))

        step.assert_not_called()
        self.assertEqual([status for status, _ in finished], ["completed"])
        self.assertEqual(finished[0][1]["campus_attachments"], {"status": "disabled"})

    def test_trigger_scan(self):
        store = JobStore()
        step = forbidden_step()
        with backend_app(), \
             patch.object(internal.pipeline_jobs, "mark_running"), \
             patch.object(internal.pipeline_jobs, "update_progress"), \
             patch.object(internal.pipeline_jobs, "complete_job", side_effect=store.complete_job), \
             patch.object(phase1_research, "_run_program_discovery", side_effect=fake_discovery), \
             patch.object(phase1_research, "_run_campus_attachment_step", step):
            asyncio.run(internal._run_scan("s1", "scan-job"))

        step.assert_not_called()
        self.assertEqual(store.completed[0]["result"]["campus_attachments"], {"status": "disabled"})


if __name__ == "__main__":
    unittest.main()
