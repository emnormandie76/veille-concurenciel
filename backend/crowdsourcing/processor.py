"""
backend/crowdsourcing/processor.py — Traitement Backend Workflow A (Étape 7.3)

Traite les tickets Submission de l'utilisateur :
- Lit les ContributionInbox `Pending_AI` (source User_Submission).
- Extrait la source (Tavily extract).
- Fact check via Gemma 26B.
- Extract complet via Gemma 31B.
- Met à jour le status vers `Pending_Admin`.
"""

import json
import logging
import psycopg2
import psycopg2.extras
from backend.tavily_service.client import extract_from_urls
from backend.ai.gemma_client import fact_check, call_gemma
from backend.tavily_service.strategies import PIPELINE_STRATEGIES
from backend.tavily_service.key_manager import QuotaExhaustedError
import backend.ai.prompts as prompts

logger = logging.getLogger("pipeline.processor")

def process_pending_submissions(key_manager):
    from backend.db import get_db_connection
    logger.info("🔄 [Crowdsourcing] Démarrage du traitement des soumissions utilisateurs")

    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT id, user_text, urls, ai_category
                    FROM "ContributionInbox"
                    WHERE status = 'Pending_AI' AND source_type = 'User_Submission'
                    ORDER BY "createdAt" ASC
                    LIMIT 20
                    """
                )
                tickets = cur.fetchall()

            if not tickets:
                logger.info("✅ [Crowdsourcing] Aucune soumission en attente.")
                return

            for ticket in tickets:
                ticket_id = ticket["id"]
                category = ticket["ai_category"]
                urls = ticket["urls"]
                user_text = ticket["user_text"] or "Information signalée par l'utilisateur."

                # Ne traiter que les catégories connues
                if category not in PIPELINE_STRATEGIES and category != "Program_Discovery":
                    logger.warning(f"⚠️ Catégorie inconnue {category} pour le ticket {ticket_id}")
                    _update_ticket_status(conn, ticket_id, "Rejected")
                    continue

                try:
                    raw_content = extract_from_urls(urls, key_manager)
                except QuotaExhaustedError as e:
                    logger.error(f"🛑 [Crowdsourcing] Quota Tavily épuisé — arrêt du traitement: {e}")
                    break

                if not raw_content:
                    _update_ticket_status(conn, ticket_id, "Rejected", {"error": "Extraction Tavily échouée"})
                    continue

                # 2. Fact checking Gemma 26B
                check = fact_check(user_text, raw_content)
                if not check or not check.get("confirmed"):
                    logger.info(f"🚫 [Crowdsourcing] Revendication non confirmée pour le ticket {ticket_id}: {check}")
                    _update_ticket_status(conn, ticket_id, "Rejected", {"error": "Fact Check échoué", "details": check})
                    continue

                # 3. Extraction de la donnée Gemma 31B
                strategy = PIPELINE_STRATEGIES.get(category)
                system_prompt = getattr(prompts, f"{category.upper()}_SYSTEM_PROMPT", "") if category != "Program_Discovery" else prompts.PHASE1_SYSTEM_PROMPT
                req_keys = strategy["required_json_keys"] if strategy else prompts.PHASE1_REQUIRED_KEYS
                
                extracted = call_gemma(
                    model=strategy["gemma_model"] if strategy else "models/gemma-4-31b-it",
                    system_prompt=system_prompt,
                    user_content=f"<TEXTE_SOURCE>\\n{raw_content[:80000]}\\n</TEXTE_SOURCE>",
                    required_keys=req_keys
                )

                if extracted:
                    with conn.cursor() as update_cur:
                        update_cur.execute(
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
                                ticket_id
                            )
                        )
                    conn.commit()
                    logger.info(f"✅ [Crowdsourcing] Ticket {ticket_id} validé par l'IA -> Pending_Admin")
                else:
                    _update_ticket_status(conn, ticket_id, "Rejected", {"error": "Extraction JSON échouée"})

    except Exception as e:
        logger.error(f"❌ [Crowdsourcing] Erreur générale: {e}")

def _update_ticket_status(conn, ticket_id, status, error_details=None):
    import json
    with conn.cursor() as cur:
        if error_details:
             cur.execute('UPDATE "ContributionInbox" SET status = %s, ai_extracted_json = %s WHERE id = %s', (status, json.dumps(error_details), ticket_id))
        else:
             cur.execute('UPDATE "ContributionInbox" SET status = %s WHERE id = %s', (status, ticket_id))
    conn.commit()
