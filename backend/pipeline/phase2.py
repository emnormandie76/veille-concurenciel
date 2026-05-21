"""
backend/pipeline/phase2.py — Phase 2 : Enrichissement — Étape 6.4

Orchestrateur de la Phase 2 :
  1. Lire tous les Programs validés de l'école
  2. Pour chaque Catégorie et Programme :
     - Vérifier CronTarget (blacklist)
     - Tavily search dynamique (via PIPELINE_STRATEGIES)
     - is_content_relevant (Gemma 26B) -> skip si non pertinent
     - Extraction (Gemma 31B)
     - diff.has_data_changed -> skip si identique
     - INSERT ContributionInbox
"""

import logging
import psycopg2
import psycopg2.extras
import uuid
from typing import Any

from backend.tavily_service.strategies import PIPELINE_STRATEGIES
from backend.ai.gemma_client import call_gemma, is_content_relevant
from backend.pipeline.diff import has_data_changed
from backend.tavily_service.client import search_web
import backend.ai.prompts as prompts

logger = logging.getLogger("pipeline.phase2")

def _get_prompt_for_category(category: str) -> str:
    if category == "Pricing": return prompts.PRICING_SYSTEM_PROMPT
    if category == "Ranking": return prompts.RANKING_SYSTEM_PROMPT
    if category == "Capacity": return prompts.CAPACITY_SYSTEM_PROMPT
    if category == "SchoolStats": return prompts.SCHOOL_STATS_SYSTEM_PROMPT
    if category == "Accreditation": return prompts.ACCREDITATION_SYSTEM_PROMPT
    return ""

def _get_existing_record(cur, category: str, school_id: str, program_id: str | None) -> dict | None:
    if category == "Pricing" and program_id:
        cur.execute('SELECT * FROM "PricingRecord" WHERE "programId" = %s ORDER BY "academic_year" DESC LIMIT 1', (program_id,))
        return cur.fetchone()
    if category == "Ranking" and program_id:
        cur.execute('SELECT * FROM "RankingRecord" WHERE "programId" = %s ORDER BY "academic_year" DESC LIMIT 1', (program_id,))
        return cur.fetchone()
    if category == "Capacity" and program_id:
        cur.execute('SELECT * FROM "CapacityRecord" WHERE "programId" = %s ORDER BY "academic_year" DESC LIMIT 1', (program_id,))
        return cur.fetchone()
    if category == "SchoolStats":
        cur.execute('SELECT * FROM "SchoolStatsRecord" WHERE "schoolId" = %s ORDER BY "academic_year" DESC LIMIT 1', (school_id,))
        return cur.fetchone()
    if category == "Accreditation":
        # For Accreditations there could be Multiple. For diffing we can just ignore or do simple logic. Return None to always trigger.
        return None
    return None

def _record_failure(cur, school_id: str, program_id: str | None, category: str):
    cur.execute(
        """
        INSERT INTO "CronTarget" (id, "schoolId", "programId", data_category, failed_attempts_count, is_blacklisted)
        VALUES (%s, %s, %s, %s, 1, false)
        ON CONFLICT ("schoolId", "programId", data_category) 
        DO UPDATE SET failed_attempts_count = "CronTarget".failed_attempts_count + 1,
                      is_blacklisted = CASE WHEN "CronTarget".failed_attempts_count + 1 >= 3 THEN true ELSE "CronTarget".is_blacklisted END
        """,
        (str(uuid.uuid4()), school_id, program_id, category)
    )

def _reset_failure(cur, school_id: str, program_id: str | None, category: str):
    cur.execute(
        """
        UPDATE "CronTarget" 
        SET failed_attempts_count = 0, is_blacklisted = false 
        WHERE "schoolId" = %s AND ("programId" = %s OR ("programId" IS NULL AND %s IS NULL)) AND data_category = %s
        """,
        (school_id, program_id, program_id, category)
    )

def run_phase2(school_id: str, key_manager: Any) -> dict:
    from backend.db import get_db_connection
    import json
    
    logger.info(f"🚀 Phase 2 démarrée pour school_id={school_id}")
    
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute('SELECT id, name, official_domain, status FROM "School" WHERE id = %s', (school_id,))
            school = cur.fetchone()
            if not school or school["status"] != "ACTIVE":
                return {"success": False, "message": "École non trouvée ou inactive"}
                
            cur.execute('SELECT p.id, p.name, p."campusId", c.name as campus_name FROM "Program" p JOIN "Campus" c ON p."campusId" = c.id WHERE c."schoolId" = %s', (school_id,))
            programs = cur.fetchall()

            categories_scanned = 0
            tickets_created = 0

            # ── Parcours des Catégories de niveau École (SchoolStats, Accreditation) ───────────────────
            for category in ["SchoolStats", "Accreditation"]:
                categories_scanned += 1
                cur.execute('SELECT is_blacklisted FROM "CronTarget" WHERE "schoolId" = %s AND "programId" IS NULL AND data_category = %s', (school_id, category))
                cron = cur.fetchone()
                if cron and cron["is_blacklisted"]:
                    continue
                    
                strategy = PIPELINE_STRATEGIES[category]
                t_query = strategy["tavily"]["query"].format(school=school["name"])
                
                raw_content = search_web(t_query, key_manager, include_domains=[school["official_domain"]] if "{official_domain}" in strategy["tavily"]["include_domains"] else strategy["tavily"]["include_domains"], search_depth=strategy["tavily"]["search_depth"], max_results=strategy["tavily"]["max_results"])
                
                if not is_content_relevant(raw_content, category):
                    _record_failure(cur, school_id, None, category)
                    continue

                prompt = _get_prompt_for_category(category)
                extracted = call_gemma(
                    model=strategy["gemma_model"],
                    system_prompt=prompt,
                    user_content=f"<TEXTE_SOURCE>\\n{raw_content[:80000]}\\n</TEXTE_SOURCE>",
                    required_keys=strategy["required_json_keys"]
                )
                
                if extracted:
                    existing = _get_existing_record(cur, category, school_id, None)
                    if has_data_changed(extracted, existing):
                        cur.execute(
                            """INSERT INTO "ContributionInbox" (id, source_type, "schoolId", "campusId", "programId", ai_category, ai_extracted_json, status, year_assumed, data_conflict_warning)
                               VALUES (%s, 'Automated_AI', %s, NULL, NULL, %s, %s, 'Pending_Admin', %s, %s)""",
                            (str(uuid.uuid4()), school_id, category, json.dumps(extracted), extracted.get("year_assumed", False), extracted.get("data_conflict_warning", False))
                        )
                        _reset_failure(cur, school_id, None, category)
                        tickets_created += 1
                else:
                    _record_failure(cur, school_id, None, category)
            
            # ── Parcours des Catégories de niveau Programme (Pricing, Ranking, Capacity) ───────────────────
            for program in programs:
                for category in ["Pricing", "Ranking", "Capacity"]:
                    categories_scanned += 1
                    cur.execute('SELECT is_blacklisted FROM "CronTarget" WHERE "schoolId" = %s AND "programId" = %s AND data_category = %s', (school_id, program["id"], category))
                    cron = cur.fetchone()
                    if cron and cron["is_blacklisted"]:
                        continue

                    strategy = PIPELINE_STRATEGIES[category]
                    t_query = strategy["tavily"]["query"].format(program=program["name"], school=school["name"], campus=program["campus_name"])
                    domains = []
                    for d in strategy["tavily"]["include_domains"]:
                        domains.append(school["official_domain"] if d == "{official_domain}" else d)
                    
                    raw_content = search_web(t_query, key_manager, include_domains=domains, search_depth=strategy["tavily"]["search_depth"], max_results=strategy["tavily"]["max_results"])
                    if not is_content_relevant(raw_content, category):
                        _record_failure(cur, school_id, program["id"], category)
                        continue

                    prompt = _get_prompt_for_category(category)
                    extracted = call_gemma(
                        model=strategy["gemma_model"],
                        system_prompt=prompt,
                        user_content=f"<TEXTE_SOURCE>\\n{raw_content[:80000]}\\n</TEXTE_SOURCE>",
                        required_keys=strategy["required_json_keys"]
                    )
                    
                    if extracted:
                        existing = _get_existing_record(cur, category, school_id, program["id"])
                        if has_data_changed(extracted, existing):
                            cur.execute(
                                """INSERT INTO "ContributionInbox" (id, source_type, "schoolId", "campusId", "programId", ai_category, ai_extracted_json, status, year_assumed, data_conflict_warning)
                                   VALUES (%s, 'Automated_AI', %s, %s, %s, %s, %s, 'Pending_Admin', %s, %s)""",
                                (str(uuid.uuid4()), school_id, program["campusId"], program["id"], category, json.dumps(extracted), extracted.get("year_assumed", False), extracted.get("data_conflict_warning", False))
                            )
                            _reset_failure(cur, school_id, program["id"], category)
                            tickets_created += 1
                        else:
                            _reset_failure(cur, school_id, program["id"], category)
                    else:
                        _record_failure(cur, school_id, program["id"], category)
            
            conn.commit()
            logger.info(f"✅ Phase 2 terminée : {categories_scanned} scans, {tickets_created} tickets créés")
            return {"success": True, "tickets_created": tickets_created}
