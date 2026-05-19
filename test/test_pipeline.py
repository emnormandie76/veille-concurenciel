import os
import re
import json
import time
import logging
import requests
from tavily import TavilyClient
from google import genai
from google.genai import types

# ── Configuration et Clés API ──────────────────────────────────────
TAVILY_API_KEY = "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"
# Récupération de la clé Gemini utilisée précédemment
os.environ["GEMINI_API_KEY"] = "AIzaSyAKIIfKpcLTpzRrSuq_uinvhzf1RsA8kO4"

logger = logging.getLogger("pipeline_test")
logging.basicConfig(level=logging.INFO)

client = genai.Client()

# ── 1. Étape Tavily : Recherche (Search) sur Multiples Sites ────────────────────────
def search_and_prepare_context(query: str) -> str:
    """Utilise l'outil search de Tavily pour agréger plusieurs sources et faire un contexte épais."""
    logger.info(f"Appel Tavily (Search avancé) pour : {query}")
    
    tavily_client = TavilyClient(api_key=TAVILY_API_KEY)
    response = tavily_client.search(
        query=query, 
        search_depth="advanced", 
        include_answer=True, # Active l'IA Tavily pour faire une synthèse longue des résultats
        max_results=4 # Force l'analyse de 7 sites pour accumuler du volume
    )
    
    synthese = response.get("answer", "")
    contexte = f"📝 SYNTHÈSE GLOBALE TAVILY :\n{synthese}\n\n🔍 EXTRAITS DÉTAILLÉS DES SITES :\n"
    
    for idx, res in enumerate(response.get("results", [])):
        # On ajoute le bout de texte de la page (le content de la source)
        contexte += f"► Source {idx+1} ({res.get('url')}):\n{res.get('content')}\n\n"
        
    logger.info(f"Taille du contexte préparé : {len(contexte)} caractères.")
    return contexte


# ── 2. Fonctions Utilitaires Gemma ────────────────────────────────
def clean_gemma_json(raw_text: str) -> str:
    cleaned = raw_text.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    elif cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    return cleaned.strip()

def call_gemma_31b(system_prompt: str, user_prompt: str) -> dict | None:
    logger.info("Appel de Gemma 31B...")
    try:
        response = client.models.generate_content(
            model="models/gemma-4-31b-it", # Utilisation stricte de la 31B
            contents=f"{system_prompt}\n\n{user_prompt}"
        )
        
        parsed_data = json.loads(clean_gemma_json(response.text))
        return parsed_data
    except Exception as e:
        logger.error(f"Erreur d'extraction Gemma : {e}")
        try:
            logger.error(f"Brut reçu : {response.text[:200]}")
        except:
            pass
        return None


# ── 3. Orchestration du Pipeline ──────────────────────────────────
def test_full_pipeline():
    requete_cible = "Tarifs scolarité cursus Programme Grande Ecole EMLV frais par année d'étude et frais de dossier 2025 2026"
    
    # A. Chercher sur 7 sites, extraire la réponse IA, et lier tout le contenu
    texte_propre = search_and_prepare_context(requete_cible)
    if len(texte_propre) < 100:
        logger.error("Contexte trop faible, échec de l'étape de recherche.")
        return
        
    print(f"\n--- APERÇU DU CONTEXTE ({len(texte_propre)} caractères) ---")
    print(texte_propre[:600] + "\n...[suite du contexte épais]...\n")
    SYSTEM_PROMPT = """
Tu es un extracteur de données éducatives. Tu dois analyser UNIQUEMENT le texte
fourni entre les balises <TEXTE_SOURCE> et </TEXTE_SOURCE>.

RÈGLES ABSOLUES :
- Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ou après.
- Respecte STRICTEMENT les clés demandées.
- Si une information financière n'est pas trouvable, mets la valeur à null.

Structure JSON attendue (basée sur le Prisma schema PricingRecord) :
{
    "academic_year": entier (l'année de début, ex: 2024) ou null si inconnu,
    "currency": "EUR" ou devise trouvée,
    "year_1_fee": entier ou null,
    "year_2_fee": entier ou null,
    "year_3_fee": entier ou null,
    "year_4_fee": entier ou null,
    "year_5_fee": entier ou null,
    "total_fee": entier ou null (si donné en tarification globale),
    "intl_year_1_fee": entier ou null (pour étudiants hors-UE),
    "intl_total_fee": entier ou null (pour étudiants hors-UE),
    "intl_currency": chaîne ou null,
    "additional_fees_notes": "texte mentionnant frais de concours, CVEC, asso..." ou null,
    "source_url": "L'URL retenue pour votre conclusion principale"
}
"""

    user_prompt = f"<TEXTE_SOURCE>\nRequête d'origine: {requete_cible}\n\n{texte_propre}\n</TEXTE_SOURCE>"
    
    # C. Envoyer à Gemma 31B
    resultat_json = call_gemma_31b(system_prompt=SYSTEM_PROMPT, user_prompt=user_prompt)
    
    if resultat_json:
        print("\n" + "="*50)
        print("✅ PIPELINE TERMINÉ AVEC SUCCÈS")
        print("="*50)
        print(json.dumps(resultat_json, indent=4, ensure_ascii=False))
    else:
        print("\n❌ Le pipeline a échoué à l'étape Gemma.")

if __name__ == "__main__":
    test_full_pipeline()
