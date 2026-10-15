"""
La file des contributions publiques : `process_pending_submissions`
(backend/crowdsourcing/processor.py).

Chaque ticket traité paie une extraction Tavily et deux appels Gemma. Plan
backend-local, étape 7 (P0) : la sélection (les 20 plus anciens `Pending_AI`,
et les `Failed` rejouables selon leur compteur et leur délai), une catégorie
inconnue → `Rejected`, un quota épuisé → arrêt du lot.

Le traitement d'un ticket (`process_crowdsourcing_ticket`) est tenu par
test/test_crowdsourcing_processor.py, et la lecture de file en échec par
test/test_scheduler_registration.py ; ici, il est remplacé.

Ni base ni réseau : `Queue` joue `ContributionInbox` et applique aux lignes la
sélection que portent la requête et ses paramètres.
"""

import json
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from backend.ai.gemma_client import GemmaAPIError
from backend.crowdsourcing import processor
from backend.tavily_service.key_manager import QuotaExhaustedError

NOW = datetime(2026, 10, 14, 9, 0, tzinfo=timezone.utc)
NOW_EPOCH = NOW.timestamp()


def _ticket(ticket_id, *, status="Pending_AI", category="Pricing", source="User_Submission",
            minutes_ago=0, attempts=None, failed_minutes_ago=None, retry_in_minutes=None):
    payload = None
    if attempts is not None or failed_minutes_ago is not None or retry_in_minutes is not None:
        payload = {}
        if attempts is not None:
            payload["processing_attempts"] = attempts
        if failed_minutes_ago is not None:
            payload["failed_at_epoch"] = NOW_EPOCH - failed_minutes_ago * 60
        if retry_in_minutes is not None:
            payload["retry_not_before_epoch"] = NOW_EPOCH + retry_in_minutes * 60
    return {
        "id": ticket_id, "status": status, "ai_category": category, "source_type": source,
        "createdAt": NOW - timedelta(minutes=minutes_ago), "ai_extracted_json": payload,
    }


class Queue:
    """ContributionInbox, et les deux requêtes que fait la file."""

    def __init__(self, rows):
        self.rows = rows
        self.statements = []

    @contextmanager
    def connection(self):
        yield self

    def cursor(self, cursor_factory=None):
        queue = self

        class Cursor:
            def __init__(self):
                self._result = []

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def fetchall(self):
                return list(self._result)

            def execute(self, sql, params=()):
                sql = " ".join(sql.split())
                queue.statements.append((sql, params))
                if sql.startswith('UPDATE "ContributionInbox" SET status = %s'):
                    status, *rest = params
                    row = next(r for r in queue.rows if r["id"] == rest[-1])
                    row["status"] = status
                    if len(rest) == 2:
                        row["ai_extracted_json"] = json.loads(rest[0])
                    return
                assert sql.startswith("SELECT ti.id, ti.ai_category FROM \"ContributionInbox\" ti")
                assert "WHERE ti.source_type = 'User_Submission'" in sql
                assert sql.endswith('ORDER BY ti."createdAt" ASC LIMIT 20')
                max_attempts, delay_seconds = params
                # La porte des tickets différés (aucun modèle disponible) est dans le SQL.
                assert "retry_not_before_epoch" in sql

                def replayable(row):
                    payload = row["ai_extracted_json"] or {}
                    return (
                        row["status"] == "Failed"
                        and int(payload.get("processing_attempts", 0)) < max_attempts
                        and float(payload.get("failed_at_epoch", 0)) < NOW_EPOCH - delay_seconds
                        and float(payload.get("retry_not_before_epoch", 0)) < NOW_EPOCH
                    )

                selected = [
                    r for r in queue.rows
                    if r["source_type"] == "User_Submission"
                    and (r["status"] == "Pending_AI" or replayable(r))
                ]
                selected.sort(key=lambda r: r["createdAt"])
                self._result = [{"id": r["id"], "ai_category": r["ai_category"]} for r in selected[:20]]

        return Cursor()


@pytest.fixture
def queue(monkeypatch):
    def install(rows):
        db = Queue(rows)
        monkeypatch.setattr("backend.db.get_db_connection", db.connection)
        return db
    return install


@pytest.fixture
def processed(monkeypatch):
    """Le traitement d'un ticket, remplacé : il note l'ordre des appels."""
    fake = MagicMock(return_value=None)
    monkeypatch.setattr(processor, "process_crowdsourcing_ticket", fake)
    return fake


def _ids(fake):
    return [c.args[0] for c in fake.call_args_list]


# ── Sélection ────────────────────────────────────────────────────────

def test_les_20_plus_anciens_pending_ai_dans_l_ordre(queue, processed):
    queue([_ticket(f"t{i:02d}", minutes_ago=i) for i in range(25)])

    report = processor.process_pending_submissions(key_manager="km")

    assert _ids(processed) == [f"t{i:02d}" for i in range(24, 4, -1)]
    assert report == {"tickets": 20, "validated": 20, "rejected": 0, "deleted": 0,
                      "failed": 0, "deferred": 0, "quota_exhausted": False}
    assert all(c.args[1] == "km" for c in processed.call_args_list)


def test_les_failed_rejouables_selon_compteur_et_delai(queue, processed):
    queue([
        _ticket("rejouable", status="Failed", attempts=1, failed_minutes_ago=120, minutes_ago=300),
        _ticket("trop-tot", status="Failed", attempts=1, failed_minutes_ago=10, minutes_ago=290),
        _ticket("epuise", status="Failed", attempts=processor.MAX_PROCESSING_ATTEMPTS,
                failed_minutes_ago=600, minutes_ago=280),
        _ticket("sans-compteur", status="Failed", minutes_ago=270),
        _ticket("en-attente", minutes_ago=5),
    ])

    processor.process_pending_submissions(key_manager=None)

    assert _ids(processed) == ["rejouable", "sans-compteur", "en-attente"]


def test_un_ticket_differe_attend_sa_reouverture_meme_apres_le_delai(queue, processed):
    """
    Cascade épuisée et Gemma en panne : le ticket attend `retry_not_before_epoch`
    (minuit Pacifique pour un quota journalier), même quand les 60 minutes des
    tickets `Failed` sont passées : sans cette porte, Tavily serait repayé toutes
    les heures (C3).
    """
    queue([
        _ticket("attend", status="Failed", attempts=0, failed_minutes_ago=600,
                retry_in_minutes=300, minutes_ago=300),
        _ticket("rouvert", status="Failed", attempts=0, failed_minutes_ago=600,
                retry_in_minutes=-5, minutes_ago=290),
        _ticket("echec-ordinaire", status="Failed", attempts=1, failed_minutes_ago=120,
                minutes_ago=280),
    ])

    processor.process_pending_submissions(key_manager=None)

    assert _ids(processed) == ["rouvert", "echec-ordinaire"]


def test_la_requete_porte_le_plafond_et_le_delai(queue, processed):
    db = queue([])

    processor.process_pending_submissions(key_manager=None)

    [(_sql, params)] = db.statements
    assert params == (processor.MAX_PROCESSING_ATTEMPTS, processor.FAILED_RETRY_DELAY_SECONDS)
    # Le délai protège les tentatives d'une panne passagère : jamais nul.
    assert processor.FAILED_RETRY_DELAY_SECONDS > 0
    processed.assert_not_called()


def test_ni_tickets_du_pipeline_ni_tickets_clos(queue, processed):
    queue([
        _ticket("pipeline", source="Automated_AI"),
        _ticket("chez-l-admin", status="Pending_Admin"),
        _ticket("valide", status="Validated"),
        _ticket("rejete", status="Rejected"),
        _ticket("pipeline-failed", status="Failed", source="Automated_AI", attempts=0, failed_minutes_ago=999),
    ])

    report = processor.process_pending_submissions(key_manager=None)

    processed.assert_not_called()
    assert report["tickets"] == 0


# ── Catégorie inconnue ───────────────────────────────────────────────

def test_categorie_inconnue_rejected_sans_traitement(queue, processed):
    db = queue([
        _ticket("decouverte", category="Program_Discovery", minutes_ago=2),
        _ticket("inventee", category="Salaires", minutes_ago=1),
        _ticket("tarifs", category="Pricing"),
    ])

    report = processor.process_pending_submissions(key_manager=None)

    assert _ids(processed) == ["tarifs"]
    rows = {r["id"]: r for r in db.rows}
    assert rows["decouverte"]["status"] == "Rejected"
    assert rows["inventee"]["status"] == "Rejected"
    assert rows["inventee"]["ai_extracted_json"] == {"error": "Catégorie inconnue: Salaires"}
    assert rows["tarifs"]["status"] == "Pending_AI"  # le traitement remplacé n'écrit rien
    assert report == {"tickets": 3, "validated": 1, "rejected": 2, "deleted": 0,
                      "failed": 0, "deferred": 0, "quota_exhausted": False}


def test_les_cinq_categories_publiques_sont_traitees(queue, processed):
    categories = ["Pricing", "Ranking", "Capacity", "SchoolStats", "Accreditation"]
    queue([_ticket(c, category=c, minutes_ago=i) for i, c in enumerate(categories)])

    processor.process_pending_submissions(key_manager=None)

    assert sorted(_ids(processed)) == sorted(categories)


# ── Quota et erreurs ─────────────────────────────────────────────────

def test_quota_epuise_arrete_le_lot(queue, processed):
    queue([_ticket(f"t{i}", minutes_ago=10 - i) for i in range(4)])

    def run(ticket_id, _key_manager):
        if ticket_id == "t1":
            raise QuotaExhaustedError("Toutes les clés Tavily sont insuffisantes")

    processed.side_effect = run

    report = processor.process_pending_submissions(key_manager=None)

    # t2 et t3 ne sont pas tentés : chaque tentative paierait une extraction.
    assert _ids(processed) == ["t0", "t1"]
    assert report == {"tickets": 4, "validated": 1, "rejected": 0, "deleted": 0,
                      "failed": 0, "deferred": 0, "quota_exhausted": True}


def test_une_erreur_d_api_n_arrete_pas_le_lot(queue, processed):
    queue([_ticket(f"t{i}", minutes_ago=10 - i) for i in range(3)])

    def run(ticket_id, _key_manager):
        if ticket_id == "t0":
            raise GemmaAPIError("503 UNAVAILABLE")
        if ticket_id == "t1":
            raise ValueError("JSON illisible")

    processed.side_effect = run

    report = processor.process_pending_submissions(key_manager=None)

    assert _ids(processed) == ["t0", "t1", "t2"]
    # Une erreur d'API ne reste plus « en attente » : elle compte une tentative
    # (C3), comme toute autre erreur inattendue. Le test les comptait à part
    # (`api_errors`) et rangeait la seconde sous « rejected » (C2).
    assert report == {"tickets": 3, "validated": 1, "rejected": 0, "deleted": 0,
                      "failed": 2, "deferred": 0, "quota_exhausted": False}


def test_file_vide(queue, processed):
    queue([])

    assert processor.process_pending_submissions(key_manager=None) == {
        "tickets": 0, "validated": 0, "rejected": 0, "deleted": 0, "failed": 0,
        "deferred": 0, "quota_exhausted": False,
    }
