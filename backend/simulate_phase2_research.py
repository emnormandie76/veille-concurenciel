import sys
import os
import json
import logging
import traceback
import argparse
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

# --- Database Monkeypatch for Offline/Dry Run Testing ---
class MockCursor:
    def __init__(self, school_name, domain):
        self.school_name = school_name
        self.domain = domain
        self.last_query = ""

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass

    def execute(self, query, params=None):
        self.last_query = query.strip()

    def fetchone(self):
        q = self.last_query.lower()
        if "crontarget" in q:
            return {
                "id": "mock-cron-id",
                "failed_attempts_count": 0,
                "is_blacklisted": False
            }
        elif "school" in q:
            if "select distinct" in q or "count(" in q:
                # Tuple for _find_school_for_phase2
                return ("mock-school-id", self.school_name, self.domain, 2)
            else:
                # Dict for run_phase2_research
                return {
                    "id": "mock-school-id",
                    "name": self.school_name,
                    "official_domain": self.domain,
                    "status": "ACTIVE"
                }
        elif "pricingrecord" in q or "rankingrecord" in q or "capacityrecord" in q or "schoolstatsrecord" in q or "accreditationrecord" in q:
            return None
        return None

    def fetchall(self):
        q = self.last_query.lower()
        if "program" in q:
            return [
                {
                    "id": "mock-prog-1-id",
                    "name": "Programme Grande École",
                    "campusId": "mock-campus-1-id",
                    "campus_name": "Campus Lille"
                },
                {
                    "id": "mock-prog-2-id",
                    "name": "Bachelor in Business Administration",
                    "campusId": "mock-campus-2-id",
                    "campus_name": "Campus Nice"
                }
            ]
        elif "school" in q:
            return [("mock-school-id", self.school_name, self.domain, 2)]
        return []

class MockConnection:
    def __init__(self, school_name, domain):
        self.cursor_obj = MockCursor(school_name, domain)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass

    def cursor(self, cursor_factory=None):
        return self.cursor_obj

    def commit(self):
        pass

# Apply the mock
import backend.db
school_name_global = "EDHEC Business School"
domain_global = "edhec.edu"
backend.db.get_db_connection = lambda: MockConnection(school_name_global, domain_global)

from backend.tavily_service.key_manager import TavilyKeyManager
from backend.pipeline.phase2_research import run_phase2_research


def _find_school_for_phase2(preferred_school_name: str | None = None) -> dict | None:
    return {
        "id": "mock-school-id",
        "name": preferred_school_name or school_name_global,
        "official_domain": domain_global,
        "program_count": 2,
    }


def _print_run_ticket_summary(school_id: str, started_at: datetime):
    print("\nℹ️ [MOCK SUMMARY] Mode Hors-ligne / Dry-Run : aucun ticket réel inséré en BDD.")


def simulate_phase2():
    global school_name_global, domain_global
    parser = argparse.ArgumentParser(description="Simulation Phase 2 Research")
    parser.add_argument("--dry-run", action="store_true", help="Activer le mode simulation (sans écriture en BDD ni coût de crédits réel)")
    parser.add_argument("--school-name", type=str, default="EDHEC Business School", help="Nom de l'école à tester")
    parser.add_argument("--domain", type=str, default="edhec.edu", help="Domaine officiel de l'école")
    parser.add_argument("--max-programs", type=int, default=None, help="Limiter le nombre de programmes à enrichir")
    args = parser.parse_args()

    school_name_global = args.school_name
    domain_global = args.domain

    print("====================================================")
    print("🚀 DEMARRAGE DE LA SIMULATION DU PIPELINE (PHASE 2 RESEARCH) 🚀")
    print(f"Mode Dry-Run: {args.dry_run}")
    print("====================================================")

    if args.max_programs:
        os.environ["PHASE2_MAX_PROGRAMS"] = str(args.max_programs)

    school = _find_school_for_phase2(args.school_name)
    school_id = school["id"]
    print(
        f"🏫 École sélectionnée : {school['name']} (ID: {school_id}, Domaine: {school['official_domain']}, Programmes: {school['program_count']})"
    )

    print("\n🔑 Initialisation du TavilyKeyManager...")
    key_manager = TavilyKeyManager()

    print(f"\n⚡ Lancement de run_phase2_research pour school_id={school_id}...")
    started_at = datetime.now(timezone.utc)
    result = None
    run_error = None
    run_traceback = None

    try:
        result = run_phase2_research(school_id, key_manager, dry_run=args.dry_run)
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
        print("❌ La Phase 2 du pipeline Research a levé une exception.")
        if run_traceback:
            print(run_traceback)
        return

    if args.dry_run:
        print("\nℹ️ Mode Dry-Run actif: aucun ticket créé en BDD.")
        return

    print("\n🔍 Lecture des tickets Phase 2 créés pendant ce run...")
    _print_run_ticket_summary(school_id, started_at)

    ended_at = datetime.now(timezone.utc)
    duration = (ended_at - started_at).total_seconds()
    print(f"\n✅ Simulation Phase 2 Research terminée en {duration:.1f}s")


if __name__ == "__main__":
    simulate_phase2()
