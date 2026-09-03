import sys
import os
import json
import logging
import argparse

# Add parent directory to sys.path
sys.path.append(os.path.abspath("."))

# Configure logging to show all pipeline info in console
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)

sys.stdout.reconfigure(encoding='utf-8') if hasattr(sys.stdout, 'reconfigure') else None

from dotenv import load_dotenv
load_dotenv("backend/.env")

# --- Database Monkeypatch for Offline/Dry Run Testing ---
class MockCursor:
    def __init__(self, school_name, domain):
        self.school_name = school_name
        self.domain = domain
        self.call_count = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass

    def execute(self, query, params=None):
        pass

    def fetchone(self):
        return {
            "id": "mock-school-id",
            "name": self.school_name,
            "official_domain": self.domain,
            "status": "ACTIVE"
        }

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

# Apply the mock before any pipeline imports that use get_db_connection
import backend.db
# We will intercept the arguments to get the school details dynamically after parsing
school_name_global = "EDHEC Business School"
domain_global = "edhec.edu"
backend.db.get_db_connection = lambda: MockConnection(school_name_global, domain_global)

from backend.tavily_service.key_manager import TavilyKeyManager
from backend.pipeline.phase1_research import run_phase1_research

def simulate():
    global school_name_global, domain_global
    parser = argparse.ArgumentParser(description="Simulation Phase 1 Research")
    parser.add_argument("--dry-run", action="store_true", help="Activer le mode simulation (sans écriture en BDD ni coût de crédits réel)")
    parser.add_argument("--school-name", type=str, default="EDHEC Business School", help="Nom de l'école à tester")
    parser.add_argument("--domain", type=str, default="edhec.edu", help="Domaine officiel de l'école")
    args = parser.parse_args()

    school_name_global = args.school_name
    domain_global = args.domain

    print("====================================================")
    print("🚀 DEMARRAGE DE LA SIMULATION DU PIPELINE (PHASE 1 RESEARCH) 🚀")
    print(f"Mode Dry-Run: {args.dry_run}")
    print("====================================================")

    # 2. Initialiser le gestionnaire de clés Tavily
    print("\n🔑 Initialisation du TavilyKeyManager...")
    key_manager = TavilyKeyManager()

    # 3. Lancer la Phase 1 Research (Tavily Research + Gemma 26B Fallback)
    print(f"\n⚡ Lancement de run_phase1_research pour school_id=mock-school-id...")
    result = run_phase1_research("mock-school-id", key_manager, dry_run=args.dry_run)

    print("\n========================= RESULTAT =========================")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    print("============================================================")

    if args.dry_run:
        print("\nℹ️ Mode Dry-Run actif: aucun ticket créé en BDD.")
        return

if __name__ == "__main__":
    simulate()
