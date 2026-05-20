import os
import json
import uuid
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "backend", ".env"))

def run_tests_7():
    print("🚀 Début des tests de l'Étape 7...")
    import backend.crowdsourcing.processor as proc
    from backend.ai.gemma_client import fact_check
    
    # Mocker extract_from_urls
    import backend.tavily.client as tc
    orig_extract = tc.extract_from_urls
    def mock_extract(urls, key_manager):
        return "Nos locaux sont incroyables et l'école de commerce coûte 8500€ pour le PGE."
    tc.extract_from_urls = mock_extract
    
    # Commenter le mock pour tester l'API réelle
    # import backend.ai.gemma_client as gc
    
    # orig_fact_check = gc.fact_check
    # def mock_fact_check(claim, context):
    #     return {"confirmed": True, "details": "La claim est vérifiée via mock."}
    # gc.fact_check = mock_fact_check
    
    from backend.ai.gemma_client import fact_check
    fact_check_res = fact_check("Le prix est de 8500€", "Nos locaux sont incroyables et l'école de commerce coûte 8500€ pour le PGE.")
    print(f"✅ fact_check renvoie : {fact_check_res}")
    
    # Rétablir pour de potentiels autres tests (optionnel)
    # gc.fact_check = orig_fact_check
    
    print("\n✅ Test mock FastAPI prêt pour le Crowdsourcing.")

if __name__ == "__main__":
    run_tests_7()