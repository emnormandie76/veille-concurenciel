import os
import json
import uuid
import psycopg2
from dotenv import load_dotenv

# Load env vars
load_dotenv(os.path.join(os.path.dirname(__file__), "backend", ".env"))

def run_tests():
    print("🚀 Début des tests de l'Étape 6...")
    
    # ── Test 1 : PIPELINE_STRATEGIES ─────────────────────────
    from backend.tavily.strategies import PIPELINE_STRATEGIES
    assert "Pricing" in PIPELINE_STRATEGIES
    assert "{official_domain}" in PIPELINE_STRATEGIES["Pricing"]["tavily"]["include_domains"]
    print("✅ PIPELINE_STRATEGIES['Pricing'] retourne la bonne config")

    # ── Test 2 : has_data_changed identiques ────────────────
    from backend.pipeline.diff import has_data_changed
    old_data = {"year_1_fee": 8000, "currency": "EUR"}
    new_data_same = {"year_1_fee": 8000, "currency": "EUR", "source_url": "http://", "year_assumed": False}
    assert not has_data_changed(new_data_same, old_data)
    print("✅ has_data_changed avec données identiques → False")

    # ── Test 3 : has_data_changed modifié ───────────────────
    new_data_diff = {"year_1_fee": 8500, "currency": "EUR"}
    assert has_data_changed(new_data_diff, old_data)
    print("✅ has_data_changed avec prix modifié → True")

    # ── Test 4 & 5 : is_content_relevant ────────────────────
    import backend.ai.gemma_client as gc
    original_call_gemma = gc.call_gemma
    def mock_call_gemma(model, system_prompt, user_content, *args, **kwargs):
        if "frais de scolarité" in user_content.lower():
            return {"relevant": True}
        return {"relevant": False}
    gc.call_gemma = mock_call_gemma
    
    txt_tarifs = "Nos frais de scolarité s'élèvent à 8000 euros par an pour le PGE. Contactez-nous." * 10
    assert gc.is_content_relevant(txt_tarifs, "Pricing")
    print("✅ is_content_relevant avec un texte de tarifs → True")

    txt_cookie = "Veuillez accepter nos cookies pour continuer sur le site. Cliquez sur Accepter." * 10
    assert not gc.is_content_relevant(txt_cookie, "Pricing")
    print("✅ is_content_relevant avec un texte de cookies/paywall → False")
    
    gc.call_gemma = original_call_gemma

    print("\n✅ Tous les tests sont validés avec succès.")

if __name__ == "__main__":
    run_tests()
