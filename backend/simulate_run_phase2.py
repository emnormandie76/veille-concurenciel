import sys
import os
import json
import logging
import traceback
from datetime import datetime, timezone

# Add parent directory to sys.path
sys.path.append(os.path.abspath("."))

# Configure logging to show all pipeline info in console
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from dotenv import load_dotenv

load_dotenv("backend/.env")

from backend.db import get_db_connection
from backend.tavily_service.key_manager import TavilyKeyManager
from backend.pipeline.phase2 import run_phase2


def _find_school_for_phase2(preferred_school_name: str | None = None) -> dict | None:
    """
    Pick one ACTIVE school that already has at least one program.
    Optionally prioritize a given school name.
    """
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            if preferred_school_name:
                cur.execute(
                    '''
                    SELECT s.id, s.name, s.official_domain, COUNT(p.id) AS program_count
                    FROM "School" s
                    JOIN "Campus" c ON c."schoolId" = s.id
                    JOIN "Program" p ON p."campusId" = c.id
                    WHERE s.status = 'ACTIVE' AND s.name = %s
                    GROUP BY s.id, s.name, s.official_domain
                    ''',
                    (preferred_school_name,),
                )
                row = cur.fetchone()
                if row:
                    return {
                        "id": row[0],
                        "name": row[1],
                        "official_domain": row[2],
                        "program_count": int(row[3] or 0),
                    }

            cur.execute(
                '''
                SELECT s.id, s.name, s.official_domain, COUNT(p.id) AS program_count
                FROM "School" s
                JOIN "Campus" c ON c."schoolId" = s.id
                JOIN "Program" p ON p."campusId" = c.id
                WHERE s.status = 'ACTIVE'
                GROUP BY s.id, s.name, s.official_domain
                ORDER BY COUNT(p.id) DESC, s.name ASC
                LIMIT 1
                '''
            )
            row = cur.fetchone()
            if not row:
                return None

            return {
                "id": row[0],
                "name": row[1],
                "official_domain": row[2],
                "program_count": int(row[3] or 0),
            }


def _print_run_ticket_summary(school_id: str, started_at: datetime):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    '''
                    SELECT
                        ci.id,
                        ci.ai_category,
                        ci.status,
                        ci."createdAt",
                        c.name AS campus_name,
                        p.name AS program_name,
                        ci.year_assumed,
                        ci.data_conflict_warning,
                        ci.ai_extracted_json
                    FROM "ContributionInbox" ci
                    LEFT JOIN "Campus" c ON c.id = ci."campusId"
                    LEFT JOIN "Program" p ON p.id = ci."programId"
                    WHERE ci."schoolId" = %s
                      AND ci.source_type = 'Automated_AI'
                      AND ci.ai_category IN ('Pricing', 'Ranking', 'Capacity', 'SchoolStats', 'Accreditation')
                    ORDER BY ci."createdAt" DESC
                    LIMIT 20
                    ''',
                    (school_id,),
                )
                rows = cur.fetchall()
    except Exception as exc:
        print(f"\n⚠️ Impossible de lire le résumé des tickets: {exc}")
        return

    if not rows:
        print("\nℹ️ Aucun ticket Phase 2 trouvé pour cette école.")
        return

    print("\n--- RÉSUMÉ DES TICKETS PHASE 2 RÉCENTS ---")
    by_category = {}
    for row in rows:
        category = row[1]
        by_category.setdefault(category, []).append(row)

    print(f"Total tickets créés: {len(rows)}")
    for category, items in sorted(by_category.items()):
        ids = [ticket[0] for ticket in items]
        print(f"- {category}: {len(items)} ticket(s)")
        print(f"  IDs: {', '.join(ids)}")

    print("\n--- DÉTAILS ---")
    for row in rows:
        ticket_id = row[0]
        category = row[1]
        status = row[2]
        created_at = row[3]
        campus_name = row[4]
        program_name = row[5]
        year_assumed = row[6]
        conflict = row[7]
        extracted = row[8]

        if isinstance(extracted, str):
            try:
                extracted = json.loads(extracted)
            except Exception:
                pass

        print("\n-----------------------------------------------")
        print(f"Ticket ID : {ticket_id}")
        print(f"Catégorie : {category}")
        print(f"Statut    : {status}")
        print(f"Créé le   : {created_at}")
        print(f"Campus    : {campus_name}")
        print(f"Programme : {program_name}")
        print(f"Flags     : year_assumed={year_assumed}, data_conflict_warning={conflict}")

        if isinstance(extracted, dict):
            preview = dict(list(extracted.items())[:8])
            print("JSON extrait (aperçu) :")
            print(json.dumps(preview, indent=2, ensure_ascii=False))
        else:
            print("JSON extrait :")
            print(str(extracted)[:600])


def simulate_phase2():
    print("====================================================")
    print("🚀 DEMARRAGE DE LA SIMULATION DU PIPELINE (PHASE 2) 🚀")
    print("====================================================")

    # Optional: target a specific school by env var for reproducible tests.
    preferred_school_name = os.environ.get("PHASE2_SCHOOL_NAME")
    max_programs = os.environ.get("PHASE2_MAX_PROGRAMS")

    if max_programs:
        os.environ["PHASE2_MAX_PROGRAMS"] = max_programs

    school = _find_school_for_phase2(preferred_school_name)
    if not school:
        print("❌ Aucune école ACTIVE avec au moins un programme n'a été trouvée.")
        print("💡 Prérequis : valider un ticket Program_Discovery depuis /admin/inbox pour créer Campus + Program.")
        return

    school_id = school["id"]
    print(
        f"🏫 École sélectionnée : {school['name']} (ID: {school_id}, Domaine: {school['official_domain']}, Programmes: {school['program_count']})"
    )

    print("\n🔑 Initialisation du TavilyKeyManager...")
    key_manager = TavilyKeyManager()

    print(f"\n⚡ Lancement de run_phase2 pour school_id={school_id}...")
    started_at = datetime.now(timezone.utc)
    result = None
    run_error = None
    run_traceback = None

    try:
        result = run_phase2(school_id, key_manager)
    except Exception as exc:
        run_error = exc
        run_traceback = traceback.format_exc()

    print("\n========================= RESULTAT =========================")
    if result is not None:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(json.dumps({"success": False, "error": str(run_error)}, indent=2, ensure_ascii=False))
    print("============================================================")

    if run_error is not None:
        print("❌ La Phase 2 du pipeline a levé une exception.")
        if run_traceback:
            print(run_traceback)
        print("\n🔍 Tickets éventuellement créés avant l'échec:")
        _print_run_ticket_summary(school_id, started_at)
        return

    if not result.get("success"):
        print("❌ La Phase 2 du pipeline a échoué.")
        print("\n🔍 Tickets éventuellement créés avant l'échec:")
        _print_run_ticket_summary(school_id, started_at)
        return

    print("\n🔍 Lecture des tickets Phase 2 créés pendant ce run...")
    _print_run_ticket_summary(school_id, started_at)

    ended_at = datetime.now(timezone.utc)
    duration = (ended_at - started_at).total_seconds()
    print(f"\n✅ Simulation Phase 2 terminée en {duration:.1f}s")


if __name__ == "__main__":
    simulate_phase2()
