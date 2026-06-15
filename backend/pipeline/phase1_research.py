"""
backend/pipeline/phase1_research.py — Phase 1 : Cartographie via Tavily Research (Étape R3)

Séquence :
  1. Lire l'école en BDD (official_domain, status)
  2. Vérifier/créer CronTarget (blacklist check)
  3. Construire le prompt dynamique pour Tavily Research
  4. Lancer Tavily Research avec output_schema
  5. Parser le résultat (JSON direct ou fallback Gemma 26B sur rapport texte)
  6. Insérer dans ContributionInbox (status=Pending_Admin, source_type=Automated_AI)
  7. Réinitialiser les compteurs d'échec dans CronTarget en cas de succès, sinon _record_failure
"""

import logging
import psycopg2
import psycopg2.extras
import uuid
import json
from datetime import datetime, timezone
from typing import Optional, Callable

from backend.ai.gemma_client import call_gemma, GemmaError
import backend.ai.prompts as prompts
from backend.ai.research_schemas import PHASE1_OUTPUT_SCHEMA
from backend.ai.research_prompts import build_phase1_research_input
from backend.tavily_service.research_client import create_research_task

logger = logging.getLogger("pipeline.phase1_research")

MAX_FAILURES_BEFORE_BLACKLIST = 3


def run_phase1_research(school_id: str, key_manager, dry_run: bool = False, progress_callback: Callable[[dict], None] | None = None) -> dict:
    """
    Orchestrateur complet de la Phase 1 via Tavily Research pour une école.
    """
    from backend.db import get_db_connection

    logger.info(f"🚀 [Research] Phase 1 démarrée pour school_id={school_id} (dry_run={dry_run})")

    if progress_callback:
        progress_callback({"current_action": "Lecture de l'école en BDD", "school": school_id, "category": "Program_Discovery"})

    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:

            # ── 1. Lire l'école ───────────────────────────────────
            cur.execute(
                'SELECT id, name, official_domain, status FROM "School" WHERE id = %s',
                (school_id,)
            )
            school = cur.fetchone()

            if not school:
                logger.error(f"❌ École non trouvée: {school_id}")
                return {"success": False, "message": "École non trouvée"}

            if school["status"] != "ACTIVE":
                logger.info(f"⏭️ École non ACTIVE ({school['status']}), skip")
                return {"success": False, "message": f"École non ACTIVE: {school['status']}"}

            school_name = school["name"]
            official_domain = school["official_domain"]
            logger.info(f"📚 École: {school_name} ({official_domain})")

            if progress_callback:
                progress_callback({"current_action": "Vérification CronTarget", "school": school_name, "category": "Program_Discovery"})

            # ── 2. Vérifier/créer CronTarget ──────────────────────
            cur.execute(
                """
                SELECT id, failed_attempts_count, is_blacklisted
                FROM "CronTarget"
                WHERE "schoolId" = %s AND "programId" IS NULL AND data_category = 'Program_Discovery'
                """,
                (school_id,)
            )
            cron_target = cur.fetchone()

            if cron_target:
                if cron_target["is_blacklisted"] and not dry_run:
                    logger.warning(
                        f"🚫 École blacklistée après {cron_target['failed_attempts_count']} échecs: {school_name}"
                    )
                    return {
                        "success": False,
                        "message": f"École blacklistée (is_blacklisted=True) — Admin doit débloquer",
                        "blacklisted": True,
                    }
                cron_target_id = cron_target["id"]
            else:
                # Créer le CronTarget s'il n'existe pas
                cron_target_id = str(uuid.uuid4())
                cur.execute(
                    """
                    INSERT INTO "CronTarget" (id, "schoolId", "programId", data_category,
                        failed_attempts_count, is_blacklisted)
                    VALUES (%s, %s, NULL, 'Program_Discovery', 0, false)
                    ON CONFLICT ("schoolId", "programId", data_category) DO NOTHING
                    RETURNING id
                    """,
                    (cron_target_id, school_id)
                )
                row = cur.fetchone()
                if row:
                    cron_target_id = row["id"]
                logger.info(f"✅ CronTarget créé pour {school_name} (Program_Discovery)")

    # ── 3. Construire le prompt et exécuter Tavily Research ─────────
    if progress_callback:
        progress_callback({"current_action": "Recherche Tavily Research en cours...", "school": school_name, "category": "Program_Discovery"})

    query = build_phase1_research_input(school_name, official_domain)
    
    try:
        research_result = create_research_task(
            query=query,
            key_manager=key_manager,
            include_domains=[official_domain],
            output_schema=PHASE1_OUTPUT_SCHEMA,
            model="pro",
            dry_run=dry_run
        )
    except Exception as e:
        logger.error(f"❌ Échec appel Tavily Research pour {official_domain}: {e}")
        if not dry_run:
            _record_failure(school_id, cron_target_id)
        return {"success": False, "message": f"Erreur Tavily Research: {e}"}

    if dry_run:
        return {
            "success": True,
            "message": "[DRY RUN] Tâche simulée avec succès",
            "report": research_result["report"],
            "sources": research_result["sources"]
        }

    # ── 4. Parser le résultat (output_schema ou fallback Gemma 26B) ──
    if progress_callback:
        progress_callback({"current_action": "Analyse et structuration du résultat", "school": school_name, "category": "Program_Discovery"})

    report_content = research_result.get("report")
    extracted = None

    if isinstance(report_content, dict):
        # L'output_schema a fonctionné directement
        logger.info("🎉 Tavily Research a retourné un JSON structuré valide directement.")
        extracted = report_content
    elif isinstance(report_content, str):
        # L'output_schema a échoué ou a été ignoré, nous avons du texte brut.
        # Nous essayons de parser si c'est du JSON sous forme de chaîne de caractères
        try:
            from backend.ai.gemma_client import clean_gemma_json
            cleaned = clean_gemma_json(report_content)
            extracted = json.loads(cleaned)
            logger.info("🎉 Tavily Research a retourné une chaîne JSON que nous avons pu parser.")
        except Exception:
            # Fallback vers Gemma 26B pour convertir le texte brut en JSON structuré
            logger.info("⚠️ Tavily Research a retourné du texte brut. Passage au fallback Gemma 26B...")
            user_content = f"<TEXTE_SOURCE>\n{report_content}\n</TEXTE_SOURCE>"
            try:
                extracted = call_gemma(
                    model="models/gemma-4-26b-a4b-it",
                    system_prompt=prompts.PHASE1_SYSTEM_PROMPT,
                    user_content=user_content,
                    required_keys=prompts.PHASE1_REQUIRED_KEYS,
                    max_retries=3,
                    temperature=0.1
                )
            except GemmaError as e:
                logger.error(f"❌ Échec du fallback Gemma 26B: {e}")
                _record_failure(school_id, cron_target_id)
                return {"success": False, "message": f"Échec fallback Gemma 26B: {e}"}

    # Validation ultime de la présence des campus découverts
    if not extracted or not isinstance(extracted.get("discovered_campuses"), list) or not extracted["discovered_campuses"]:
        logger.error(f"❌ Données extraites vides ou invalides pour {school_name}")
        _record_failure(school_id, cron_target_id)
        return {"success": False, "message": "Données extraites vides ou invalides"}

    # ── 5. INSERT dans ContributionInbox ─────────────────────────
    if progress_callback:
        progress_callback({"current_action": "Insertion dans ContributionInbox", "school": school_name, "category": "Program_Discovery"})

    campuses_count = len(extracted["discovered_campuses"])
    programs_count = sum(
        len(c.get("programs", []))
        for c in extracted["discovered_campuses"]
    )

    inbox_id = str(uuid.uuid4())
    # Utiliser les URLs retournées par Tavily Research si disponibles, sinon le domaine officiel
    sources = research_result.get("sources", [])
    source_urls = [s.get("url") for s in sources if s.get("url")]
    if not source_urls:
        source_urls = extracted.get("source_urls", [f"https://{official_domain}"])

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO "ContributionInbox"
                    (id, source_type, "schoolId", ai_category, ai_extracted_json,
                     status, urls, "createdAt")
                VALUES (%s, 'Automated_AI', %s, 'Program_Discovery', %s,
                        'Pending_Admin', %s, %s)
                """,
                (
                    inbox_id,
                    school_id,
                    json.dumps(extracted),
                    source_urls,
                    datetime.now(timezone.utc),
                )
            )

            # Réinitialiser les compteurs d'échec en cas de succès
            cur.execute(
                """
                UPDATE "CronTarget"
                SET failed_attempts_count = 0, last_failed_attempt = NULL
                WHERE id = %s
                """,
                (cron_target_id,)
            )

    logger.info(
        f"✅ Phase 1 via Research terminée pour {school_name}: "
        f"{campuses_count} campus, {programs_count} programmes → Inbox #{inbox_id[:8]}"
    )

    return {
        "success": True,
        "message": f"Ticket Program_Discovery créé via Research (Pending_Admin)",
        "inbox_id": inbox_id,
        "school_name": school_name,
        "campuses_count": campuses_count,
        "programs_count": programs_count,
    }


def _record_failure(school_id: str, cron_target_id: str):
    """
    Incrémente failed_attempts_count sur CronTarget.
    Blackliste après MAX_FAILURES_BEFORE_BLACKLIST tentatives.
    """
    from backend.db import get_db_connection

    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    UPDATE "CronTarget"
                    SET
                        failed_attempts_count = failed_attempts_count + 1,
                        last_failed_attempt = %s,
                        is_blacklisted = CASE
                            WHEN failed_attempts_count + 1 >= %s THEN true
                            ELSE false
                        END
                    WHERE id = %s
                    RETURNING failed_attempts_count, is_blacklisted
                    """,
                    (datetime.now(timezone.utc), MAX_FAILURES_BEFORE_BLACKLIST, cron_target_id)
                )
                result = cur.fetchone()
                if result:
                    count = result["failed_attempts_count"]
                    blacklisted = result["is_blacklisted"]
                    if blacklisted:
                        logger.error(
                            f"🚫 [Research] BLACKLIST déclenché après {count} échecs "
                            f"(school_id={school_id})"
                        )
                    else:
                        logger.warning(
                            f"⚠️ [Research] Échec #{count}/{MAX_FAILURES_BEFORE_BLACKLIST} "
                            f"enregistré (school_id={school_id})"
                        )
    except Exception as e:
        logger.error(f"Erreur lors de l'enregistrement de l'échec: {e}")
