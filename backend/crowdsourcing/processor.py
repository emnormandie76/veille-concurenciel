"""
backend/crowdsourcing/processor.py — Traitement Backend Workflow A (Étape 7.3)

Traite les tickets Submission de l'utilisateur :
- Lit les ContributionInbox `Pending_AI` (source User_Submission).
- Extrait la source (Tavily extract).
- Vérifie d'abord la compatibilité de la page via Gemma 26B (sans user_text).
- Extrait les données structurées via Gemma 31B (sans user_text).
- Met à jour le status vers `Pending_Admin`.
"""

import json
import logging
import asyncio
import psycopg2
import psycopg2.extras
from backend.tavily_service.client import extract_from_urls
from backend.ai.gemma_client import call_gemma, GemmaError, GemmaAPIError, GemmaParsingError
from backend.tavily_service.strategies import PIPELINE_STRATEGIES
from backend.tavily_service.key_manager import QuotaExhaustedError
import backend.ai.prompts as prompts

logger = logging.getLogger("pipeline.processor")

SUPPORTED_CROWDSOURCING_CATEGORIES = [
    "Pricing",
    "Ranking",
    "Capacity",
    "SchoolStats",
    "Accreditation",
]

class TicketNotFoundError(Exception):
    pass

class TavilyExtractionError(Exception):
    pass

_key_manager = None

async def process_crowdsourcing_ticket(ticket_id: str) -> None:
    """
    Traite un ticket ContributionInbox de type User_Submission.
    
    Règle stricte : user_text n'est jamais passé aux modèles IA.
    Il est stocké en base et affiché uniquement dans le dashboard Admin.
    
    Args:
        ticket_id: UUID du ticket ContributionInbox à traiter
        
    Raises:
        TicketNotFoundError: Si le ticket n'existe pas en base
        TavilyExtractionError: Si Tavily échoue sur toutes les URLs
        GemmaError: Si Gemma retourne un JSON invalide après les retries
    """
    global _key_manager
    if _key_manager is None:
        from backend.tavily_service.key_manager import TavilyKeyManager
        _key_manager = TavilyKeyManager()

    from backend.db import get_db_connection

    # 1. RÉCEPTION
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT ti.id, ti.user_text, ti.urls, ti.ai_category, ti."schoolId" AS school_id, ti."programId" AS program_id, s.name AS school_name
                FROM "ContributionInbox" ti
                JOIN "School" s ON s.id = ti."schoolId"
                WHERE ti.id = %s AND ti.source_type = 'User_Submission'
                """,
                (ticket_id,)
            )
            ticket = cur.fetchone()

    if not ticket:
        raise TicketNotFoundError(f"Ticket {ticket_id} non trouvé dans ContributionInbox")

    urls = ticket["urls"]
    category = ticket["ai_category"]
    school_name = ticket["school_name"]
    program_id = ticket["program_id"]

    try:
        # Validation du rattachement à un parcours pour les catégories concernées
        if category in ["Pricing", "Ranking", "Capacity"] and not program_id:
            raise GemmaParsingError(
                f"Le ticket de catégorie {category} doit être rattaché à un parcours (programId manquant)."
            )
        # 2. EXTRACTION PAGE (Tavily)
        try:
            raw_content = extract_from_urls(urls, _key_manager)
        except QuotaExhaustedError:
            raise
        except Exception as e:
            raise TavilyExtractionError(f"Erreur lors de l'extraction Tavily: {e}")

        if not raw_content or len(raw_content.strip()) < 50:
            raise TavilyExtractionError("Le contenu extrait par Tavily est vide ou trop court (< 50 chars)")

        # 3. VÉRIFICATION COMPATIBILITÉ (Gemma 26B)
        compatibility_prompt = prompts.CROWDSOURCING_COMPATIBILITY_CHECK.format(
            categories=category,
            school_name=school_name,
            page_content=raw_content[:80000]
        )

        compatibility_res = call_gemma(
            model="models/gemma-4-26b-a4b-it",
            system_prompt="Tu es un assistant d'analyse de compatibilité.",
            user_content=compatibility_prompt,
            required_keys=["compatible"],
            max_retries=4,
            temperature=0.1,
        )

        compatible = compatibility_res.get("compatible", False)
        reason = compatibility_res.get("reason", "Page incompatible")

        if not compatible:
            with get_db_connection() as conn:
                _update_ticket_status(conn, ticket_id, "Rejected", {"reason": reason})
            return

        # 4. EXTRACTION JSON (Gemma 31B)
        strategy = PIPELINE_STRATEGIES.get(category)
        system_prompt = getattr(prompts, f"{category.upper()}_SYSTEM_PROMPT", "")
        req_keys = strategy["required_json_keys"] if strategy else prompts.PHASE1_REQUIRED_KEYS
        gemma_model = strategy["gemma_model"] if strategy else "models/gemma-4-31b-it"

        extracted = call_gemma(
            model=gemma_model,
            system_prompt=system_prompt,
            user_content=f"<TEXTE_SOURCE>\n{raw_content[:80000]}\n</TEXTE_SOURCE>",
            required_keys=req_keys,
            max_retries=4,
            temperature=0.1,
        )

        # Validation des valeurs extraites obligatoires non-nulles
        if category == "Capacity":
            spots_available = extracted.get("spots_available")
            academic_year = extracted.get("academic_year")
            if spots_available is None or academic_year is None:
                raise GemmaParsingError(
                    f"Données Capacity incomplètes. spots_available={spots_available}, academic_year={academic_year}"
                )
        elif category == "Ranking":
            ranking_name = extracted.get("ranking_name")
            rank = extracted.get("rank")
            academic_year = extracted.get("academic_year")
            if not ranking_name or rank is None or academic_year is None:
                raise GemmaParsingError(
                    f"Données Ranking incomplètes. ranking_name={ranking_name}, rank={rank}, academic_year={academic_year}"
                )
        elif category == "Pricing":
            academic_year = extracted.get("academic_year")
            if academic_year is None:
                raise GemmaParsingError("Données Pricing incomplètes. academic_year est requis.")
            
            # Vérifier qu'au moins un frais de scolarité est non null
            pricing_keys = [
                "year_1_fee",
                "year_2_fee",
                "year_3_fee",
                "year_4_fee",
                "year_5_fee",
                "total_fee",
                "intl_year_1_fee",
                "intl_total_fee",
            ]
            if not any(extracted.get(k) is not None for k in pricing_keys):
                raise GemmaParsingError("Données Pricing incomplètes. Aucun frais de scolarité valide n'a été extrait.")

        # 5. MISE À JOUR INBOX
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE "ContributionInbox"
                    SET status = 'Pending_Admin',
                        ai_extracted_json = %s,
                        year_assumed = %s,
                        data_conflict_warning = %s
                    WHERE id = %s
                    """,
                    (
                        json.dumps(extracted),
                        extracted.get("year_assumed", False),
                        extracted.get("data_conflict_warning", False),
                        ticket_id,
                    )
                )
            conn.commit()
            logger.info(f"✅ [Crowdsourcing] Ticket {ticket_id} validé par l'IA -> Pending_Admin")

    except QuotaExhaustedError:
        raise
    except GemmaAPIError as e:
        logger.error(f"🛑 [Crowdsourcing] Erreur API temporaire réseau/Google. Ticket {ticket_id} conservé en Pending_AI. Détails: {e}")
        raise
    except (GemmaParsingError, TavilyExtractionError) as e:
        logger.error(f"❌ [Crowdsourcing] Erreur permanente de parsing/données. Ticket {ticket_id} rejeté. Détails: {e}")
        with get_db_connection() as conn:
            _update_ticket_status(conn, ticket_id, "Rejected", {"parsing_error": str(e)})
        raise
    except Exception as e:
        logger.error(f"❌ [Crowdsourcing] Erreur inattendue. Ticket {ticket_id} rejeté. Détails: {e}")
        with get_db_connection() as conn:
            _update_ticket_status(conn, ticket_id, "Rejected", {"error": f"Exception inattendue: {str(e)}"})
        raise

def process_pending_submissions(key_manager):
    from backend.db import get_db_connection
    logger.info("🔄 [Crowdsourcing] Démarrage du traitement des soumissions utilisateurs")
    global _key_manager
    _key_manager = key_manager

    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT ti.id, ti.ai_category
                    FROM "ContributionInbox" ti
                    WHERE ti.status = 'Pending_AI' AND ti.source_type = 'User_Submission'
                    ORDER BY ti."createdAt" ASC
                    LIMIT 20
                    """
                )
                tickets = cur.fetchall()

            if not tickets:
                logger.info("✅ [Crowdsourcing] Aucune soumission en attente.")
                return

            success_tickets = []
            api_error_tickets = []
            parsing_error_tickets = []

            for ticket in tickets:
                ticket_id = ticket["id"]
                category = ticket["ai_category"]

                if category not in SUPPORTED_CROWDSOURCING_CATEGORIES:
                    logger.warning(f"⚠️ Catégorie inconnue {category} pour le ticket {ticket_id}")
                    _update_ticket_status(conn, ticket_id, "Rejected", {"error": f"Catégorie inconnue: {category}"})
                    parsing_error_tickets.append(ticket_id)
                    continue

                logger.info(f"⚙️ Traitement du ticket {ticket_id} (Catégorie: {category})")
                try:
                    asyncio.run(process_crowdsourcing_ticket(ticket_id))
                    success_tickets.append(ticket_id)
                except QuotaExhaustedError as e:
                    logger.error(f"🛑 [Crowdsourcing] Quota Tavily épuisé — arrêt du traitement: {e}")
                    break
                except GemmaAPIError as e:
                    logger.error(f"🛑 [Crowdsourcing] Erreur API sur le ticket {ticket_id}: {e}")
                    api_error_tickets.append(ticket_id)
                    continue
                except Exception as e:
                    logger.error(f"❌ Erreur lors du traitement du ticket {ticket_id}: {e}")
                    parsing_error_tickets.append(ticket_id)
                    continue

            # Rapport de fin de traitement
            logger.info("=== 📊 RAPPORT DE CROWDSOURCING ===")
            logger.info(f"✅ Validés (Pending_Admin)  : {len(success_tickets)} ticket(s) -> {success_tickets}")
            logger.info(f"⏳ Erreurs API (Pending_AI) : {len(api_error_tickets)} ticket(s) -> {api_error_tickets}")
            logger.info(f"❌ Rejetés (Rejected)       : {len(parsing_error_tickets)} ticket(s) -> {parsing_error_tickets}")
            logger.info("==================================")
    except Exception as e:
        logger.error(f"❌ [Crowdsourcing] Erreur générale: {e}")

def _update_ticket_status(conn, ticket_id, status, error_details=None):
    with conn.cursor() as cur:
        if error_details:
             cur.execute('UPDATE "ContributionInbox" SET status = %s, ai_extracted_json = %s WHERE id = %s', (status, json.dumps(error_details), ticket_id))
        else:
             cur.execute('UPDATE "ContributionInbox" SET status = %s WHERE id = %s', (status, ticket_id))
    conn.commit()
