"""
backend/ai/model_chain.py — Les modèles d'IA que le backend appelle

Une seule source pour ce que `pipeline-status` annonce à /admin/cron : les
modèles du crowdsourcing et du pipeline. Ils étaient écrits en dur dans la route
(`ai_model_primary` : Gemma 31B), ce qui est faux depuis que le crowdsourcing
passe par la cascade Gemini (tâche hors plan C1 à C4).

Gemma n'est plus qu'un dernier recours : le code ne l'appelle que lorsque la
cascade Gemini est épuisée au-dessus du plancher de la catégorie
(processor._extract_with_cascade).
"""

from backend.ai.gemini_client import MODEL_LADDER

# Dernier recours du crowdsourcing : la vérification de compatibilité (petit
# modèle) et l'extraction.
GEMMA_COMPATIBILITY_MODEL = "models/gemma-4-26b-a4b-it"
GEMMA_EXTRACTION_MODEL = "models/gemma-4-31b-it"


def describe_model_chain() -> dict:
    """
    Le bloc `ai_models` de pipeline-status : la cascade Gemini, du plus fort au
    plus faible, puis les deux modèles Gemma du dernier recours.
    """
    return {
        "cascade": [{"model": model, "tier": tier} for model, tier in MODEL_LADDER],
        "last_resort": {
            "compatibility": GEMMA_COMPATIBILITY_MODEL,
            "extraction": GEMMA_EXTRACTION_MODEL,
        },
    }
