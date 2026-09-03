import pytest
import json
import sys
import os

# Définir une clé d'API fictive pour éviter que TavilyKeyManager ne lève une exception lors de l'initialisation
os.environ["TAVILY_API_KEY"] = "dummy-key-for-testing"

# S'assurer que la racine est dans le PYTHONPATH pour trouver backend
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from unittest.mock import patch
from backend.crowdsourcing.processor import process_crowdsourcing_ticket

# Le gestionnaire de cles Tavily est desormais injecte explicitement (il ne peut
# plus etre instancie a la volee). Les appels Tavily etant mockes dans ces tests,
# un objet sentinelle suffit.
FAKE_KEY_MANAGER = object()

def test_user_text_never_reaches_gemma():
    """
    Vérifie que le commentaire utilisateur n'est jamais injecté
    dans les appels à Gemma, quelle que soit sa valeur.
    """
    provocateur_user_text = "trop cool les données sur le site, j'adore!"

    mock_ticket = {
        "id": "test-uuid-001",
        "user_text": provocateur_user_text,
        "urls": ["https://www.emlv.fr/admissions/tarifs-et-financements/"],
        "ai_category": "Pricing",
        "school_id": "school-uuid-001",
        "program_id": "program-uuid-001",
        "school_name": "EMLV",
    }

    with patch("backend.db.get_db_connection") as mock_get_db, \
         patch("backend.crowdsourcing.processor.extract_from_urls") as mock_extract, \
         patch("backend.crowdsourcing.processor.call_gemma") as mock_gemma, \
         patch("backend.crowdsourcing.processor._update_ticket_status") as mock_update:

        # Mock database connection cursor
        mock_conn = mock_get_db.return_value.__enter__.return_value
        mock_cur = mock_conn.cursor.return_value.__enter__.return_value
        mock_cur.fetchone.return_value = mock_ticket

        # S'assurer que le contenu retourné fait au moins 50 caractères
        mock_extract.return_value = "Frais de scolarité 2025-2026 : 9800€/an. Ce contenu est suffisamment long pour passer la validation de longueur du processeur."
        mock_gemma.side_effect = [
            {"compatible": True, "matched_categories": ["Pricing"], "reason": "Tarifs trouvés"},
            {"academic_year": 2025, "currency": "EUR", "year_1_fee": 9800, "year_assumed": False, "data_conflict_warning": False},
        ]

        process_crowdsourcing_ticket("test-uuid-001", FAKE_KEY_MANAGER)

        # Vérifier que call_gemma a bien été appelé deux fois
        assert mock_gemma.call_count == 2

        # Vérifier qu'aucun appel à Gemma ne contient user_text
        for gemma_call in mock_gemma.call_args_list:
            prompt_sent = gemma_call.args[2] if len(gemma_call.args) > 2 else gemma_call.kwargs.get("user_content", "")
            assert provocateur_user_text not in prompt_sent, (
                f"ÉCHEC : user_text a été trouvé dans le prompt Gemma :\n{prompt_sent}"
            )

def test_incompatible_page_is_rejected():
    """
    Si Gemma 26B retourne compatible=false, le ticket doit passer
    en status Rejected et Gemma 31B ne doit pas être appelé.
    """
    mock_ticket = {
        "id": "test-uuid-002",
        "user_text": "voici une source intéressante",
        "urls": ["https://www.emlv.fr/about/"],
        "ai_category": "Pricing",
        "school_id": "school-uuid-001",
        "program_id": "program-uuid-001",
        "school_name": "EMLV",
    }

    with patch("backend.db.get_db_connection") as mock_get_db, \
         patch("backend.crowdsourcing.processor.extract_from_urls") as mock_extract, \
         patch("backend.crowdsourcing.processor.call_gemma") as mock_gemma, \
         patch("backend.crowdsourcing.processor._update_ticket_status") as mock_update:

        # Mock database connection cursor
        mock_conn = mock_get_db.return_value.__enter__.return_value
        mock_cur = mock_conn.cursor.return_value.__enter__.return_value
        mock_cur.fetchone.return_value = mock_ticket

        mock_extract.return_value = "L'EMLV est une école de management fondée en 1975..."
        mock_gemma.return_value = {"compatible": False, "matched_categories": [], "reason": "Page de présentation générale"}

        process_crowdsourcing_ticket("test-uuid-002", FAKE_KEY_MANAGER)

        # Gemma ne doit être appelé qu'une seule fois (le check de compatibilité)
        assert mock_gemma.call_count == 1, "Gemma 31B ne doit pas être appelé si la page est incompatible"

        # Le ticket doit être rejeté
        # Signature reelle : _update_ticket_status(ticket_id, status, error_details).
        # Le test attendait un premier parametre `conn`, supprime par un refactor
        # jamais repercute ici : les tests ne passaient plus depuis.
        mock_update.assert_called_once_with("test-uuid-002", "Rejected", {"reason": "Page de présentation générale"})

def test_valid_ticket_produces_pending_admin():
    """
    Un ticket avec une page compatible doit produire un ticket
    en status Pending_Admin avec un JSON extrait non vide.
    """
    mock_ticket = {
        "id": "test-uuid-003",
        "user_text": None,
        "urls": ["https://www.emlv.fr/frais-de-scolarite/"],
        "ai_category": "Pricing",
        "school_id": "school-uuid-001",
        "program_id": "program-uuid-001",
        "school_name": "EMLV",
    }

    expected_json = {
        "academic_year": 2025,
        "currency": "EUR",
        "year_1_fee": 9800,
        "year_2_fee": 10200,
        "total_fee": None,
        "source_url": "https://www.emlv.fr/frais-de-scolarite/",
        "year_assumed": False,
        "data_conflict_warning": False,
    }

    with patch("backend.db.get_db_connection") as mock_get_db, \
         patch("backend.crowdsourcing.processor.extract_from_urls") as mock_extract, \
         patch("backend.crowdsourcing.processor.call_gemma") as mock_gemma, \
         patch("backend.crowdsourcing.processor._update_ticket_status") as mock_update:

        # Mock database connection cursor
        mock_conn = mock_get_db.return_value.__enter__.return_value
        mock_cur = mock_conn.cursor.return_value.__enter__.return_value
        mock_cur.fetchone.return_value = mock_ticket

        # S'assurer que le contenu retourné fait au moins 50 caractères
        mock_extract.return_value = "Frais année 1 : 9800€, année 2 : 10200€. Ce contenu est suffisamment long pour passer la validation de longueur du processeur."
        mock_gemma.side_effect = [
            {"compatible": True, "matched_categories": ["Pricing"], "reason": "Tableau de frais trouvé"},
            expected_json,
        ]

        process_crowdsourcing_ticket("test-uuid-003", FAKE_KEY_MANAGER)

        # Pas d assertion sur commit() : c est get_db_connection() lui-meme, en
        # tant que gestionnaire de contexte, qui commite — et il est mocke ici.
        # Ce qui compte est la requete reellement emise, verifiee juste apres.
        executed_sqls = [call_args[0][0] for call_args in mock_cur.execute.call_args_list]
        assert any("UPDATE" in sql and "Pending_Admin" in sql for sql in executed_sqls)


def test_api_error_keeps_pending_ai():
    """
    Si Gemma API renvoie une erreur temporaire (ex: GemmaAPIError),
    le ticket ne doit pas être rejeté et doit rester en base sans mise à jour du statut.
    """
    from backend.ai.gemma_client import GemmaAPIError
    mock_ticket = {
        "id": "test-uuid-004",
        "user_text": None,
        "urls": ["https://www.emlv.fr/pricing/"],
        "ai_category": "Pricing",
        "school_id": "school-uuid-001",
        "program_id": "program-uuid-001",
        "school_name": "EMLV",
    }

    with patch("backend.db.get_db_connection") as mock_get_db, \
         patch("backend.crowdsourcing.processor.extract_from_urls") as mock_extract, \
         patch("backend.crowdsourcing.processor.call_gemma") as mock_gemma, \
         patch("backend.crowdsourcing.processor._update_ticket_status") as mock_update:

        # Mock database connection cursor
        mock_conn = mock_get_db.return_value.__enter__.return_value
        mock_cur = mock_conn.cursor.return_value.__enter__.return_value
        mock_cur.fetchone.return_value = mock_ticket

        mock_extract.return_value = "Frais de scolarité : 9800€ par an. Ce contenu est suffisamment long pour passer la validation de longueur du processeur."
        mock_gemma.side_effect = GemmaAPIError("HTTP 500 Internal Server Error")

        with pytest.raises(GemmaAPIError):
            process_crowdsourcing_ticket("test-uuid-004", FAKE_KEY_MANAGER)

        # Vérifier que le statut n'a PAS été mis à jour
        mock_update.assert_not_called()


def test_parsing_error_rejects_ticket():
    """
    Si Gemma renvoie une erreur permanente de parsing (ex: GemmaParsingError),
    le ticket est supprimé de l'Inbox et l'exception est propagée.
    """
    from backend.ai.gemma_client import GemmaParsingError
    mock_ticket = {
        "id": "test-uuid-005",
        "user_text": None,
        "urls": ["https://www.emlv.fr/pricing/"],
        "ai_category": "Pricing",
        "school_id": "school-uuid-001",
        "program_id": "program-uuid-001",
        "school_name": "EMLV",
    }

    with patch("backend.db.get_db_connection") as mock_get_db, \
         patch("backend.crowdsourcing.processor.extract_from_urls") as mock_extract, \
         patch("backend.crowdsourcing.processor.call_gemma") as mock_gemma, \
         patch("backend.crowdsourcing.processor._update_ticket_status") as mock_update, \
         patch("backend.crowdsourcing.processor._delete_ticket") as mock_delete:

        # Mock database connection cursor
        mock_conn = mock_get_db.return_value.__enter__.return_value
        mock_cur = mock_conn.cursor.return_value.__enter__.return_value
        mock_cur.fetchone.return_value = mock_ticket

        mock_extract.return_value = "Frais de scolarité : 9800€ par an. Ce contenu est suffisamment long pour passer la validation de longueur du processeur."
        mock_gemma.side_effect = GemmaParsingError("JSON invalide")

        with pytest.raises(GemmaParsingError):
            process_crowdsourcing_ticket("test-uuid-005", FAKE_KEY_MANAGER)

        # GemmaParsingError est une erreur PERMANENTE : le ticket est supprime,
        # il ne passe pas en Rejected. Le test attendait l inverse.
        mock_delete.assert_called_once_with("test-uuid-005")
        mock_update.assert_not_called()


@pytest.mark.asyncio
@patch("backend.ai.gemma_client.get_client")
async def test_gemma_client_list_parsing(mock_get_client):
    """
    Vérifie que call_gemma extrait correctement le premier dictionnaire
    si le modèle renvoie une liste JSON.
    """
    from backend.ai.gemma_client import call_gemma
    from unittest.mock import MagicMock

    mock_client = MagicMock()
    mock_get_client.return_value = mock_client

    # Simuler une réponse sous forme de liste JSON
    mock_response = MagicMock()
    mock_response.candidates = [MagicMock()]
    mock_response.candidates[0].finish_reason.name = "STOP"
    mock_response.text = '[\n  {\n    "key": "value"\n  }\n]'
    mock_client.models.generate_content.return_value = mock_response

    res = call_gemma(
        model="models/gemma-4-26b-a4b-it",
        system_prompt="Test system prompt",
        user_content="Test user content",
        required_keys=["key"],
        max_retries=1,
    )

    assert res == {"key": "value"}


@pytest.mark.asyncio
@patch("backend.ai.gemma_client.get_client")
async def test_gemma_client_multi_object_list_is_rejected(mock_get_client):
    """
    Une liste de PLUSIEURS objets n'est plus reduite a son premier element.

    L'ancien code gardait parsed_data[0] et jetait le reste avec un simple
    warning : l'extraction repartait amputee sans que rien n'echoue. On exige
    desormais un echec franc, quitte a perdre le ticket plutot que sa moitie.
    """
    from backend.ai.gemma_client import call_gemma, GemmaParsingError
    from unittest.mock import MagicMock

    mock_client = MagicMock()
    mock_get_client.return_value = mock_client

    mock_response = MagicMock()
    mock_response.candidates = [MagicMock()]
    mock_response.candidates[0].finish_reason.name = "STOP"
    mock_response.text = '[{"key": "premier"}, {"key": "second"}]'
    mock_client.models.generate_content.return_value = mock_response

    with pytest.raises(GemmaParsingError, match="liste de 2 objets"):
        call_gemma(
            model="models/gemma-4-26b-a4b-it",
            system_prompt="Test system prompt",
            user_content="Test user content",
            required_keys=["key"],
            max_retries=1,
        )


def test_ticket_without_program_id_switches_to_multi_program():
    """
    Un ticket Pricing/Ranking/Capacity SANS program_id ne provoque plus de rejet :
    depuis le refactor Program, il bascule en mode multi-programme, ou l IA
    rattache elle-meme chaque bloc extrait a un programme connu de l ecole.

    Ce test remplace test_ticket_without_program_id_is_rejected, qui verifiait un
    message (« doit etre rattache a un parcours ») absent du code depuis le
    refactor. Voir docs/memory/memorystep6.md.
    """
    mock_ticket = {
        "id": "test-uuid-006",
        "user_text": None,
        "urls": ["https://www.emlv.fr/pricing/"],
        "ai_category": "Pricing",
        "school_id": "school-uuid-001",
        "program_id": None,  # absent : declenche le mode multi-programme
        "school_name": "EMLV",
    }

    with patch("backend.db.get_db_connection") as mock_get_db,          patch("backend.crowdsourcing.processor.extract_from_urls") as mock_extract,          patch("backend.crowdsourcing.processor.call_gemma") as mock_gemma,          patch("backend.crowdsourcing.processor._fetch_school_programs") as mock_programs,          patch("backend.crowdsourcing.processor._update_ticket_status") as mock_update,          patch("backend.crowdsourcing.processor._delete_ticket") as mock_delete:

        mock_conn = mock_get_db.return_value.__enter__.return_value
        mock_cur = mock_conn.cursor.return_value.__enter__.return_value
        mock_cur.fetchone.return_value = mock_ticket

        mock_programs.return_value = [{"id": "program-uuid-001", "name": "PGE"}]
        mock_extract.return_value = (
            "Frais de scolarite du PGE : 9800 EUR par an. Ce contenu est suffisamment "
            "long pour passer la validation de longueur du processeur."
        )
        mock_gemma.side_effect = [
            {"compatible": True, "matched_categories": ["Pricing"], "reason": "Tableau trouve"},
            {
                "programs": [
                    {
                        "extracted_program_name": "PGE",
                        "matched_program_id": "program-uuid-001",
                        "matched_program_name": "PGE",
                        "match_confidence": "exact",
                        "data": {"academic_year": 2025, "currency": "EUR", "year_1_fee": 9800},
                    }
                ]
            },
        ]

        process_crowdsourcing_ticket("test-uuid-006", FAKE_KEY_MANAGER)

        # Le chargement de la liste des programmes est la signature du mode
        # multi-programme.
        mock_programs.assert_called_once()
        # Ni rejet, ni suppression.
        mock_update.assert_not_called()
        mock_delete.assert_not_called()
        # Le ticket part en Pending_Admin.
        executed = [c[0][0] for c in mock_cur.execute.call_args_list]
        assert any("UPDATE" in sql and "Pending_Admin" in sql for sql in executed)


def test_ticket_with_null_required_fields_is_rejected():
    """
    Vérifie qu'un ticket (ici de catégorie Capacity) dont la valeur extraite
    obligatoire est null (spots_available = null) est rejeté.
    """
    from backend.ai.gemma_client import GemmaParsingError
    mock_ticket = {
        "id": "test-uuid-007",
        "user_text": None,
        "urls": ["https://www.emlv.fr/capacity/"],
        "ai_category": "Capacity",
        "school_id": "school-uuid-001",
        "program_id": "program-uuid-001",
        "school_name": "EMLV",
    }

    with patch("backend.db.get_db_connection") as mock_get_db, \
         patch("backend.crowdsourcing.processor.extract_from_urls") as mock_extract, \
         patch("backend.crowdsourcing.processor.call_gemma") as mock_gemma, \
         patch("backend.crowdsourcing.processor._update_ticket_status") as mock_update, \
         patch("backend.crowdsourcing.processor._delete_ticket") as mock_delete:

        # Mock database connection cursor
        mock_conn = mock_get_db.return_value.__enter__.return_value
        mock_cur = mock_conn.cursor.return_value.__enter__.return_value
        mock_cur.fetchone.return_value = mock_ticket

        mock_extract.return_value = "Contenu de page pour la capacité de l'école. Cette page contient au moins 50 caractères pour passer la validation de longueur."
        
        # Simuler compatible=True et une extraction où spots_available est null (None)
        mock_gemma.side_effect = [
            {"compatible": True, "matched_categories": ["Capacity"], "reason": "Capacité trouvée"},
            {"spots_available": None, "academic_year": 2025}
        ]

        with pytest.raises(GemmaParsingError) as exc_info:
            process_crowdsourcing_ticket("test-uuid-007", FAKE_KEY_MANAGER)

        assert "spots_available=None" in str(exc_info.value)
        # Erreur permanente : suppression du ticket (voir le test precedent).
        mock_delete.assert_called_once_with("test-uuid-007")
        mock_update.assert_not_called()


# ══════════════════════════════════════════════════════════════════════
#  Retention des tickets en echec
#
#  Decision operateur : un ticket qui echoue toujours de la meme facon, sur
#  lequel l admin ne peut rien, ne doit pas etre conserve. On borne les
#  tentatives, puis on supprime.
# ══════════════════════════════════════════════════════════════════════

def _mock_cursor(monkeypatched_conn, previous_json):
    """Prepare un curseur mocke dont le SELECT renvoie previous_json."""
    cur = monkeypatched_conn.cursor.return_value.__enter__.return_value
    cur.fetchone.return_value = (previous_json,)
    return cur


def test_failed_ticket_is_kept_below_the_attempt_cap():
    """
    Sous le plafond, le ticket passe en 'Failed' et le compteur avance :
    la contribution est preservee, elle sera rejouee plus tard.
    """
    from backend.crowdsourcing.processor import _mark_ticket_failed

    with patch("backend.db.get_db_connection") as mock_get_db:
        conn = mock_get_db.return_value.__enter__.return_value
        cur = _mock_cursor(conn, {"processing_attempts": 1})

        _mark_ticket_failed("t-1", "psycopg2.OperationalError: connection closed")

        statements = [c[0][0] for c in cur.execute.call_args_list]
        assert any("UPDATE" in s for s in statements)
        assert not any("DELETE" in s for s in statements)

        # Le payload ecrit porte le compteur incremente et les deux horodatages.
        update_call = [c for c in cur.execute.call_args_list if "UPDATE" in c[0][0]][0]
        payload = json.loads(update_call[0][1][1])
        assert payload["processing_attempts"] == 2
        assert "failed_at" in payload and "failed_at_epoch" in payload


def test_failed_ticket_is_deleted_at_the_attempt_cap():
    """
    Au plafond, le ticket est supprime : le conserver n apporte rien puisque
    l erreur se reproduit a chaque passage et que l admin ne peut pas agir.
    """
    from backend.crowdsourcing.processor import (
        _mark_ticket_failed,
        MAX_PROCESSING_ATTEMPTS,
    )

    with patch("backend.db.get_db_connection") as mock_get_db:
        conn = mock_get_db.return_value.__enter__.return_value
        cur = _mock_cursor(conn, {"processing_attempts": MAX_PROCESSING_ATTEMPTS - 1})

        _mark_ticket_failed("t-2", "meme erreur, enieme fois")

        statements = [c[0][0] for c in cur.execute.call_args_list]
        assert any("DELETE" in s for s in statements)
        assert not any("UPDATE" in s for s in statements)


def test_missing_ticket_does_not_crash():
    """Un ticket disparu entre-temps ne doit pas faire tomber le traitement."""
    from backend.crowdsourcing.processor import _mark_ticket_failed

    with patch("backend.db.get_db_connection") as mock_get_db:
        conn = mock_get_db.return_value.__enter__.return_value
        cur = conn.cursor.return_value.__enter__.return_value
        cur.fetchone.return_value = None

        _mark_ticket_failed("inexistant", "peu importe")

        statements = [c[0][0] for c in cur.execute.call_args_list]
        assert not any("DELETE" in s or "UPDATE" in s for s in statements)
