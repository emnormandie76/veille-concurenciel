"""
Le rapport du crowdsourcing dit la vérité, et le registre garde le dernier
passage utile : tâche hors plan C1 à C4, point C2 (journal du 15 octobre 2026).

Constat du 15 octobre : une contribution supprimée (Gemma n'avait pas su lire sa
réponse) était rangée sous « Rejetés », une page incompatible sous « Validés »,
et `last_runs` était écrasé une minute plus tard par « aucune contribution en
attente » : plus aucune trace hors de la fenêtre du backend.

Ces tests tiennent :
- les comptes de `process_pending_submissions` : validés, rejetés (page
  incompatible, catégorie inconnue), supprimés, en échec (tentative comptée),
  différés (attente d'un modèle), arrêt sur quota ;
- le rapport de console, mot pour mot ;
- `_describe_crowdsourcing` ;
- `scheduler.crowdsourcing` de pipeline-status : le dernier passage, et le
  dernier passage qui a traité au moins un ticket, qui survit à un passage vide ;
- le bloc `ai_models`, qui remplace les trois `ai_model_*` écrits en dur.

Ni base, ni réseau : le traitement d'un ticket est remplacé.
"""

import asyncio
import logging
import types
from contextlib import contextmanager
from unittest.mock import MagicMock

import pytest

from backend import pipeline_jobs
from backend.ai.gemini_client import MODEL_LADDER
from backend.ai.gemma_client import GemmaAPIError, GemmaParsingError
from backend.crowdsourcing import processor
from backend.routers import internal
from backend.scheduler import jobs
from backend.tavily_service.key_manager import QuotaExhaustedError

EMPTY_REPORT = {
    "tickets": 0, "validated": 0, "rejected": 0, "deleted": 0, "failed": 0,
    "deferred": 0, "quota_exhausted": False,
}


def _queue(ids_and_categories):
    cursor = MagicMock()
    cursor.fetchall.return_value = [{"id": i, "ai_category": c} for i, c in ids_and_categories]
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor

    @contextmanager
    def connection():
        yield conn

    return connection


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setattr(jobs, "_last_job_runs", {})
    monkeypatch.setattr(jobs, "_last_crowdsourcing_processed", None)
    monkeypatch.setattr(jobs, "_rotation_status", lambda key_manager: {})
    monkeypatch.setattr(jobs, "_scheduler", None)
    return monkeypatch


def _outcomes(monkeypatch, tickets, behaviours):
    """File de `tickets`, dont le traitement fait ce que dit `behaviours[id]`."""
    monkeypatch.setattr("backend.db.get_db_connection", _queue(tickets))

    def run(ticket_id, _key_manager):
        behaviour = behaviours.get(ticket_id)
        if isinstance(behaviour, BaseException):
            raise behaviour
        return behaviour

    monkeypatch.setattr(processor, "process_crowdsourcing_ticket", MagicMock(side_effect=run))


MIXED = [(f"t{i}", "Pricing") for i in range(7)]
MIXED_BEHAVIOURS = {
    "t0": processor.OUTCOME_VALIDATED,
    "t1": processor.OUTCOME_REJECTED,
    "t2": GemmaParsingError("la réponse n'est pas lisible"),
    "t3": processor.TavilyExtractionError("contenu vide"),
    "t4": ValueError("coupure Neon"),
    "t5": GemmaAPIError("503"),
    "t6": processor.ExtractionDeferred("cascade épuisée", 7200),
}


# ── Les comptes ───────────────────────────────────────────────────────


def test_chaque_issue_a_son_compte(env):
    _outcomes(env, MIXED, MIXED_BEHAVIOURS)

    report = processor.process_pending_submissions(None)

    assert report == {
        "tickets": 7, "validated": 1, "rejected": 1, "deleted": 2, "failed": 2,
        "deferred": 1, "quota_exhausted": False,
    }


def test_une_page_incompatible_n_est_pas_comptee_comme_validee(env):
    _outcomes(env, [("t0", "Pricing")], {"t0": processor.OUTCOME_REJECTED})

    report = processor.process_pending_submissions(None)

    assert report["validated"] == 0 and report["rejected"] == 1


def test_un_ticket_qui_ne_rend_rien_reste_compte_comme_valide(env):
    """Le contrat d'origine : le retour `None` d'un traitement qui aboutit."""
    _outcomes(env, [("t0", "Pricing")], {})

    assert processor.process_pending_submissions(None)["validated"] == 1


def test_une_categorie_inconnue_est_rejetee_sans_traitement(env):
    env.setattr(processor, "_update_ticket_status", MagicMock())
    _outcomes(env, [("t0", "Salaires"), ("t1", "Pricing")], {})

    report = processor.process_pending_submissions(None)

    assert report == {**EMPTY_REPORT, "tickets": 2, "validated": 1, "rejected": 1}


def test_un_quota_tavily_arrete_le_lot_et_les_comptes_le_disent(env):
    _outcomes(env, [("t0", "Pricing"), ("t1", "Pricing"), ("t2", "Pricing")],
              {"t1": QuotaExhaustedError("clés refusées")})

    report = processor.process_pending_submissions(None)

    assert report == {**EMPTY_REPORT, "tickets": 3, "validated": 1, "quota_exhausted": True}


def test_file_vide_porte_toutes_les_cles(env):
    _outcomes(env, [], {})

    assert processor.process_pending_submissions(None) == EMPTY_REPORT


# ── Le rapport de console ─────────────────────────────────────────────


def test_le_rapport_de_console_dit_supprimes_pour_une_suppression(env, caplog):
    _outcomes(env, MIXED, MIXED_BEHAVIOURS)

    with caplog.at_level(logging.INFO, logger="pipeline.processor"):
        processor.process_pending_submissions(None)

    lines = [r.getMessage() for r in caplog.records if r.name == "pipeline.processor"]
    report = "\n".join(lines)
    assert "Validés (Pending_Admin)" in report and "1 ticket(s) -> ['t0']" in report
    assert "Rejetés (Rejected)" in report and "['t1']" in report
    # La suppression a son mot, et ses identifiants ; elle n'est plus sous « Rejetés ».
    deleted = next(line for line in lines if "Supprimés" in line)
    assert "2 ticket(s)" in deleted and "'t2'" in deleted and "'t3'" in deleted
    rejected = next(line for line in lines if "Rejetés (Rejected)" in line)
    assert "'t2'" not in rejected and "'t3'" not in rejected
    failed = next(line for line in lines if "En échec" in line)
    assert "'t4'" in failed and "'t5'" in failed
    deferred = next(line for line in lines if "En attente d'un modèle" in line)
    assert "'t6'" in deferred


# ── Le détail du registre ─────────────────────────────────────────────


def test_le_detail_nomme_chaque_issue():
    status, detail = jobs._describe_crowdsourcing(
        {"tickets": 7, "validated": 1, "rejected": 1, "deleted": 2, "failed": 2,
         "deferred": 1, "quota_exhausted": False}
    )
    assert status == "success"
    assert detail.startswith("7 contribution(s) : 1 en attente de l'admin")
    for expected in ("1 rejetée(s)", "2 supprimée(s)", "2 en échec", "1 différée(s)"):
        assert expected in detail, expected


def test_un_quota_epuise_reste_un_echec():
    status, detail = jobs._describe_crowdsourcing({**EMPTY_REPORT, "tickets": 1, "quota_exhausted": True})
    assert status == "failed" and "quota Tavily épuisé" in detail


# ── Le dernier passage utile ──────────────────────────────────────────


def _run_job(env, ids_and_categories, behaviours=None):
    _outcomes(env, ids_and_categories, behaviours or {})
    jobs._crowdsourcing_job(None)


def _block(env):
    return jobs.get_scheduler_status()["crowdsourcing"]


def test_avant_tout_passage_le_bloc_est_vide(env):
    assert _block(env) == {"last_run": None, "last_processed": None}


def test_le_dernier_passage_utile_survit_a_un_passage_vide(env):
    _run_job(env, MIXED, MIXED_BEHAVIOURS)
    useful = _block(env)["last_processed"]
    assert useful["counts"] == {
        "tickets": 7, "validated": 1, "rejected": 1, "deleted": 2, "failed": 2,
        "deferred": 1, "quota_exhausted": False,
    }
    assert useful["status"] == "success"
    assert useful["detail"].startswith("7 contribution(s)")
    assert useful["finished_at"]

    _run_job(env, [])  # le passage d'une minute plus tard : rien à traiter

    block = _block(env)
    assert block["last_run"]["detail"] == "aucune contribution en attente"
    assert block["last_processed"] == useful  # intact


def test_un_passage_utile_plus_recent_remplace_le_precedent(env):
    _run_job(env, MIXED, MIXED_BEHAVIOURS)
    _run_job(env, [("t0", "Pricing")], {})

    counts = _block(env)["last_processed"]["counts"]
    assert counts["tickets"] == 1 and counts["validated"] == 1


def test_une_lecture_en_echec_n_ecrase_pas_le_dernier_passage_utile(env):
    _run_job(env, MIXED, MIXED_BEHAVIOURS)
    useful = _block(env)["last_processed"]

    @contextmanager
    def unreachable():
        raise RuntimeError("base injoignable")
        yield  # pragma: no cover

    env.setattr("backend.db.get_db_connection", unreachable)
    jobs._crowdsourcing_job(None)

    block = _block(env)
    assert block["last_run"]["status"] == "failed"
    assert block["last_processed"] == useful


def test_un_arret_sur_quota_est_un_passage_utile_en_echec(env):
    _run_job(env, [("t0", "Pricing")], {"t0": QuotaExhaustedError("clés refusées")})

    useful = _block(env)["last_processed"]
    assert useful["status"] == "failed"
    assert useful["counts"]["quota_exhausted"] is True


# ── pipeline-status ───────────────────────────────────────────────────


def _pipeline_status(env):
    env.setattr("backend.db.check_db_connection", lambda: True)
    env.setattr(pipeline_jobs, "list_active_jobs", lambda limit=20: [])
    env.setattr(pipeline_jobs, "purge_finished_jobs", lambda: 0)
    state = types.SimpleNamespace(tavily_manager=None)
    request = types.SimpleNamespace(app=types.SimpleNamespace(state=state))
    return asyncio.run(internal.pipeline_status(request, _token="jeton"))


def test_pipeline_status_porte_le_bloc_crowdsourcing_meme_scheduler_arrete(env):
    _run_job(env, MIXED, MIXED_BEHAVIOURS)

    response = _pipeline_status(env)

    assert response["scheduler"]["running"] is False
    assert response["scheduler"]["crowdsourcing"]["last_processed"]["counts"]["tickets"] == 7


def test_pipeline_status_remplace_les_trois_modeles_ecrits_en_dur(env):
    response = _pipeline_status(env)

    for stale in ("ai_model_primary", "ai_model_triage", "ai_model_fallback"):
        assert stale not in response
    chain = response["ai_models"]
    assert chain["cascade"] == [{"model": m, "tier": t} for m, t in MODEL_LADDER]
    # Gemma : dernier recours, et les deux modèles que le code appelle.
    assert chain["last_resort"] == {
        "compatibility": processor.GEMMA_COMPATIBILITY_MODEL,
        "extraction": processor.GEMMA_EXTRACTION_MODEL,
    }
    assert processor.GEMMA_EXTRACTION_MODEL == "models/gemma-4-31b-it"
    assert processor.GEMMA_COMPATIBILITY_MODEL == "models/gemma-4-26b-a4b-it"
