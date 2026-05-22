import pytest
import sys
import os

# Définir une clé d'API fictive pour éviter que TavilyKeyManager ne lève une exception lors de l'initialisation
os.environ["TAVILY_API_KEY"] = "dummy-key-for-testing"

# S'assurer que la racine est dans le PYTHONPATH pour trouver backend
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from unittest.mock import patch
from backend.crowdsourcing.processor import process_crowdsourcing_ticket

@pytest.mark.asyncio
async def test_user_text_never_reaches_gemma():
    """
    Vérifie que le commentaire utilisateur n'est jamais injecté
    dans les appels à Gemma, quelle que soit sa valeur.
    """
    provocateur_user_text = "trop cool les données sur le site, j'adore!"

    mock_ticket = {
        "id": "test-uuid-001",
        "user_text": provocateur_user_text,
        "urls": ["https://www.emlv.fr/frais-scolarite/"],
        "ai_category": "Pricing",
        "school_id": "school-uuid-001",
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

        await process_crowdsourcing_ticket("test-uuid-001")

        # Vérifier que call_gemma a bien été appelé deux fois
        assert mock_gemma.call_count == 2

        # Vérifier qu'aucun appel à Gemma ne contient user_text
        for gemma_call in mock_gemma.call_args_list:
            prompt_sent = gemma_call.args[2] if len(gemma_call.args) > 2 else gemma_call.kwargs.get("user_content", "")
            assert provocateur_user_text not in prompt_sent, (
                f"ÉCHEC : user_text a été trouvé dans le prompt Gemma :\n{prompt_sent}"
            )

@pytest.mark.asyncio
async def test_incompatible_page_is_rejected():
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

        await process_crowdsourcing_ticket("test-uuid-002")

        # Gemma ne doit être appelé qu'une seule fois (le check de compatibilité)
        assert mock_gemma.call_count == 1, "Gemma 31B ne doit pas être appelé si la page est incompatible"

        # Le ticket doit être rejeté
        mock_update.assert_called_once_with(mock_conn, "test-uuid-002", "Rejected", {"reason": "Page de présentation générale"})

@pytest.mark.asyncio
async def test_valid_ticket_produces_pending_admin():
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

        await process_crowdsourcing_ticket("test-uuid-003")

        # Devrait exécuter la requête UPDATE et le commit
        assert mock_conn.commit.call_count > 0
        executed_sqls = [call_args[0][0] for call_args in mock_cur.execute.call_args_list]
        assert any("UPDATE" in sql and "Pending_Admin" in sql for sql in executed_sqls)


@pytest.mark.asyncio
async def test_api_error_keeps_pending_ai():
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
            await process_crowdsourcing_ticket("test-uuid-004")

        # Vérifier que le statut n'a PAS été mis à jour
        mock_update.assert_not_called()


@pytest.mark.asyncio
async def test_parsing_error_rejects_ticket():
    """
    Si Gemma renvoie une erreur permanente de parsing (ex: GemmaParsingError),
    le ticket doit être rejeté et son statut mis à jour vers Rejected avec les détails.
    """
    from backend.ai.gemma_client import GemmaParsingError
    mock_ticket = {
        "id": "test-uuid-005",
        "user_text": None,
        "urls": ["https://www.emlv.fr/pricing/"],
        "ai_category": "Pricing",
        "school_id": "school-uuid-001",
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
        mock_gemma.side_effect = GemmaParsingError("JSON invalide")

        with pytest.raises(GemmaParsingError):
            await process_crowdsourcing_ticket("test-uuid-005")

        # Vérifier que le statut a bien été mis à jour vers Rejected avec l'erreur
        mock_update.assert_called_once_with(mock_conn, "test-uuid-005", "Rejected", {"parsing_error": "JSON invalide"})


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
