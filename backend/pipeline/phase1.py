"""
backend/pipeline/phase1.py — Phase 1 : Cartographie (Program Discovery) — Étape 5

Implémente :
  - crawl_school_website() → appel Tavily crawl
  - extract_programs() → appel Gemma 31B avec prompt Phase 1
  - run_phase1(school_id) → orchestrateur complet

Séquence (cf. architecture.md §5.1) :
  1. Lire l'école en BDD
  2. Vérifier CronTarget (pas blacklisté)
  3. Tavily crawl(official_domain)
  4. Gemma 31B : extraction JSON campus + programmes
  5. INSERT ContributionInbox(Program_Discovery, status=Pending_Admin)
  6. En cas d'échec : incrémenter failed_attempts_count dans CronTarget
     Après 3 échecs → is_blacklisted = True

Référence : task.md §5.1-5.4, architecture.md §5.1
"""

import logging
import psycopg2
import psycopg2.extras
import uuid
import json
from datetime import datetime, timezone
from typing import Optional

from backend.ai.gemma_client import call_gemma
from backend.ai.prompts import PHASE1_SYSTEM_PROMPT, PHASE1_REQUIRED_KEYS

logger = logging.getLogger("pipeline.phase1")

# Seuil de blacklist : 3 échecs consécutifs (architecture.md §3.5)
MAX_FAILURES_BEFORE_BLACKLIST = 3


# ── Extraction Gemma Phase 1 ──────────────────────────────────────

def extract_programs(raw_content: str) -> Optional[dict]:
    """
    Envoie le contenu crawlé à Gemma 31B pour extraction des campus/programmes.

    Args:
        raw_content: Contenu Markdown des pages crawlées.

    Returns:
        Dict avec 'discovered_campuses' ou None si l'extraction échoue.

    Référence : architecture.md §5.1, gemma-python-guide.md §4
    """
    if not raw_content or len(raw_content.strip()) < 50:
        logger.warning("❌ Contenu vide ou trop court pour extraction (Edge Case 14)")
        return None

    # Tronquer si trop long (contexte Gemma ~100K tokens)
    content_truncated = raw_content[:80000]
    user_content = f"<TEXTE_SOURCE>\n{content_truncated}\n</TEXTE_SOURCE>"

    result = call_gemma(
        model="models/gemma-4-31b-it",
        system_prompt=PHASE1_SYSTEM_PROMPT,
        user_content=user_content,
        required_keys=PHASE1_REQUIRED_KEYS,
        max_retries=3,
        temperature=0.1,
    )

    if result is None:
        logger.error("❌ Gemma n'a pas pu extraire les programmes (Phase 1)")
        return None

    campuses = result.get("discovered_campuses", [])
    if not campuses or not isinstance(campuses, list):
        logger.warning(f"⚠️ discovered_campuses vide ou invalide: {campuses}")
        return None

    # Compter les programmes totaux
    total_programs = sum(len(c.get("programs", [])) for c in campuses)
    logger.info(
        f"✅ Extraction Phase 1 réussie: {len(campuses)} campus, {total_programs} programmes"
    )
    return result


# ── Orchestrateur Phase 1 ─────────────────────────────────────────

def run_phase1(school_id: str, key_manager) -> dict:
    """
    Orchestrateur complet de la Phase 1 pour une école.

    Séquence :
      1. Lire l'école en BDD (official_domain, status)
      2. Vérifier/créer CronTarget (blacklist check)
      3. Tavily crawl du site officiel
      4. Gemma 31B : extraction JSON
      5. INSERT dans ContributionInbox (Pending_Admin)
      6. En cas d'erreur : incrémenter failed_attempts_count

    Args:
        school_id: UUID de l'école
        key_manager: Instance de TavilyKeyManager

    Returns:
        Dict de résultat : {success, message, inbox_id?, campuses_count?, programs_count?}

    Référence : task.md §5.3, architecture.md §5.1
    """
    from backend.db import get_db_connection
    from backend.tavily_service.client import crawl_school_website

    logger.info(f"🚀 Phase 1 démarrée pour school_id={school_id}")

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
                if cron_target["is_blacklisted"]:
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

    # ── 3. Tavily crawl (hors transaction BDD) ───────────────────
    try:
        raw_content = crawl_school_website(official_domain, key_manager)
    except Exception as e:
        error_str = str(e)
        if "QuotaExhaustedError" in error_str or "quota" in error_str.lower():
            logger.error(f"❌ Quota Tavily épuisé: {e}")
            return {"success": False, "message": "Quota Tavily épuisé"}
        logger.error(f"❌ Erreur crawl {official_domain}: {e}")
        _record_failure(school_id, cron_target_id)
        return {"success": False, "message": f"Erreur crawl: {e}"}

    if not raw_content:
        logger.warning(f"⚠️ Contenu vide pour {official_domain} (Edge Case 14)")
        _record_failure(school_id, cron_target_id)
        return {"success": False, "message": "Contenu crawlé vide"}

    # ── 4. Gemma 31B : extraction ─────────────────────────────────
    extracted = extract_programs(raw_content)

    if not extracted:
        logger.error(f"❌ Extraction Gemma échouée pour {school_name}")
        _record_failure(school_id, cron_target_id)
        return {"success": False, "message": "Extraction Gemma échouée"}

    # ── 5. INSERT dans ContributionInbox ─────────────────────────
    campuses_count = len(extracted.get("discovered_campuses", []))
    programs_count = sum(
        len(c.get("programs", []))
        for c in extracted.get("discovered_campuses", [])
    )

    inbox_id = str(uuid.uuid4())
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
        f"✅ Phase 1 terminée pour {school_name}: "
        f"{campuses_count} campus, {programs_count} programmes → Inbox #{inbox_id[:8]}"
    )

    return {
        "success": True,
        "message": f"Ticket Program_Discovery créé (Pending_Admin)",
        "inbox_id": inbox_id,
        "school_name": school_name,
        "campuses_count": campuses_count,
        "programs_count": programs_count,
    }


# ── Enregistrement d'un échec ─────────────────────────────────────

def _record_failure(school_id: str, cron_target_id: str):
    """
    Incrémente failed_attempts_count sur CronTarget.
    Blackliste après MAX_FAILURES_BEFORE_BLACKLIST tentatives.

    Référence : architecture.md §3.5, task.md §5.3
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
                            f"🚫 BLACKLIST déclenché après {count} échecs "
                            f"(school_id={school_id})"
                        )
                    else:
                        logger.warning(
                            f"⚠️ Échec #{count}/{MAX_FAILURES_BEFORE_BLACKLIST} "
                            f"enregistré (school_id={school_id})"
                        )
    except Exception as e:
        logger.error(f"Erreur lors de l'enregistrement de l'échec: {e}")
