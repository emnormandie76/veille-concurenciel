import sys
import os
import uuid
import json
import logging

# S'assurer que le PYTHONPATH est correct
sys.path.append(os.path.abspath("."))

from dotenv import load_dotenv
load_dotenv("backend/.env")

from backend.db import get_db_connection
from backend.tavily_service.key_manager import TavilyKeyManager
from backend.crowdsourcing.processor import process_crowdsourcing_ticket

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)

def main():
    print("=== INSPECTION DE LA BASE DE DONNEES ===")
    school_id = None
    program_id = None
    
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Recherche d'une école ACTIVE
            cur.execute('SELECT id, name FROM "School" WHERE status = \'ACTIVE\'')
            schools = cur.fetchall()
            print("Ecoles actives trouvees :")
            for s in schools:
                print(f" - ID: {s[0]}, Nom: {s[1]}")
                if "emlv" in s[1].lower():
                    school_id = s[0]
            
            if not school_id:
                print("Aucune ecole active EMLV trouvee. Creation d'une ecole de test EMLV...")
                school_id = str(uuid.uuid4())
                cur.execute(
                    'INSERT INTO "School" (id, name, official_domain, status) VALUES (%s, \'EMLV\', \'www.emlv.fr\', \'ACTIVE\')',
                    (school_id,)
                )
                conn.commit()
                print(f"School creee: EMLV (ID: {school_id})")
            else:
                print(f"Ecole EMLV existante trouvee: ID: {school_id}")
            
            # Recherche ou création d'un programme pour cette école
            cur.execute('SELECT id, name FROM "Program" WHERE "schoolId" = %s LIMIT 1', (school_id,))
            prog = cur.fetchone()
            if prog:
                program_id = prog[0]
                print(f"Programme trouve : ID: {program_id}, Nom: {prog[1]}")
            else:
                print("Aucun programme trouve pour EMLV. Creation du Programme Grande Ecole...")
                program_id = str(uuid.uuid4())
                cur.execute('INSERT INTO "Program" (id, name, "schoolId") VALUES (%s, \'Programme Grande Ecole\', %s)', (program_id, school_id))
                conn.commit()
                print(f"Programme cree: Programme Grande Ecole (ID: {program_id})")

    # URL du ticket
    test_url = "https://www.emlv.fr/admissions/tarifs-et-financements/"
    print(f"\n=== CREATION D'UN TICKET DE TEST (SANS PROGRAM_ID) ===")
    print(f"URL: {test_url}")
    print(f"Categorie: Pricing")
    print(f"Ecole: {school_id}")
    
    ticket_id = str(uuid.uuid4())
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO "ContributionInbox" (id, source_type, ai_category, status, urls, "schoolId", "programId", "createdAt")
                VALUES (%s, 'User_Submission', 'Pricing', 'Pending_AI', %s, %s, NULL, NOW())
                """,
                (ticket_id, [test_url], school_id)
            )
            conn.commit()
    print(f"Ticket inséré avec succès (sans programId). ID: {ticket_id}")
    
    print("\n=== EXECUTION DU TRAITEMENT ===")
    # Le gestionnaire de cles est obligatoire : le processeur refuse d en
    # instancier un second, qui tiendrait une comptabilite de credits parallele.
    key_manager = TavilyKeyManager()
    try:
        process_crowdsourcing_ticket(ticket_id, key_manager)
    except Exception as e:
        err_msg = str(e).encode('ascii', 'ignore').decode('ascii')
        print(f"Le traitement a echoue: {err_msg}")
        
    print("\n=== RESULTATS DU TICKET EN BDD ===")
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                'SELECT status, ai_extracted_json FROM "ContributionInbox" WHERE id = %s',
                (ticket_id,)
            )
            res = cur.fetchone()
            if res:
                print(f"Statut final : {res[0]}")
                print("JSON extrait/Erreur :")
                raw_json = res[1]
                if isinstance(raw_json, str):
                    raw_json = json.loads(raw_json)
                print(json.dumps(raw_json, indent=2, ensure_ascii=True))
            else:
                print("Ticket non trouve.")

if __name__ == "__main__":
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8')
    main()
