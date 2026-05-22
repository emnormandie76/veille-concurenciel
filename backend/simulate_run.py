import sys
import os
import uuid
import json
import logging
from datetime import datetime, timezone

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

from backend.db import get_db_connection
from backend.tavily_service.key_manager import TavilyKeyManager
from backend.pipeline.phase1 import run_phase1

def simulate():
    print("====================================================")
    print("🚀 DEMARRAGE DE LA SIMULATION DU PIPELINE (PHASE 1) 🚀")
    print("====================================================")
    
    school_name = "EMLV"
    school_domain = "www.emlv.fr"
    
    # 1. Insertion ou récupération de l'école dans la base de données
    school_id = None
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Vérifier si l'école existe déjà
            cur.execute('SELECT id FROM "School" WHERE name = %s', (school_name,))
            row = cur.fetchone()
            if row:
                school_id = row[0]
                print(f"🏫 L'école '{school_name}' existe déjà en BDD (ID: {school_id})")
            else:
                school_id = str(uuid.uuid4())
                cur.execute(
                    'INSERT INTO "School" (id, name, official_domain, status) VALUES (%s, %s, %s, \'ACTIVE\')',
                    (school_id, school_name, school_domain)
                )
                print(f"➕ Nouvelle école insérée en BDD : {school_name} (ID: {school_id}, Domaine: {school_domain})")
                
    # 2. Initialiser le gestionnaire de clés Tavily
    print("\n🔑 Initialisation du TavilyKeyManager...")
    key_manager = TavilyKeyManager()
    
    # 3. Lancer la Phase 1 (Crawl + Extraction Gemma + Insertion ContributionInbox)
    print(f"\n⚡ Lancement de run_phase1 pour school_id={school_id}...")
    result = run_phase1(school_id, key_manager)
    
    print("\n========================= RESULTAT =========================")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    print("============================================================")
    
    if result.get("success"):
        inbox_id = result.get("inbox_id")
        print(f"\n🔍 Lecture du ticket ContributionInbox créé (ID: {inbox_id})...")
        
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'SELECT id, source_type, ai_category, ai_extracted_json, status, urls FROM "ContributionInbox" WHERE id = %s',
                    (inbox_id,)
                )
                row = cur.fetchone()
                if row:
                    print("\n--- TICKET CONTRIBUTION INBOX ---")
                    print(f"ID : {row[0]}")
                    print(f"Type de source : {row[1]}")
                    print(f"Catégorie IA : {row[2]}")
                    print(f"Statut : {row[4]}")
                    print(f"URLs sources : {row[5]}")
                    print("\nDonnées JSON extraites par Gemma 31B :")
                    # Parse and pretty print the json
                    extracted_json = row[3]
                    if isinstance(extracted_json, str):
                        extracted_json = json.loads(extracted_json)
                    print(json.dumps(extracted_json, indent=2, ensure_ascii=False))
                else:
                    print("❌ Le ticket créé n'a pas pu être retrouvé en BDD.")
    else:
        print("❌ La Phase 1 du pipeline a échoué.")

if __name__ == "__main__":
    simulate()
