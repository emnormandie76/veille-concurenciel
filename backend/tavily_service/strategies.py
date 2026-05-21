"""
backend/tavily/strategies.py — Dictionnaire PIPELINE_STRATEGIES (Étape 6.1)

Ce module définit la configuration par catégorie pour la recherche Tavily 
et les paramètres du modèle Gemma pour la Phase 2.

Référence : architecture.md §4.2
"""

PIPELINE_STRATEGIES = {
    "Pricing": {
        "tavily": {
            "query": "tarifs scolarité frais {program} {school} {campus} 2025 2026",
            "include_domains": ["{official_domain}"],
            "include_raw_content": True,
            "search_depth": "advanced",
            "max_results": 3
        },
        "gemma_model": "models/gemma-4-31b-it",
        "required_json_keys": ["academic_year", "currency"],
        "edge_cases": [3, 12]  # Lissage prix + devises internationales
    },
    "Ranking": {
        "tavily": {
            "query": "classement {program} {school} 2025 2026",
            "include_domains": ["lefigaro.fr", "letudiant.fr", "sigem.org", "parisien.fr"],
            "include_raw_content": True,
            "search_depth": "basic",
            "max_results": 5
        },
        "gemma_model": "models/gemma-4-31b-it",
        "required_json_keys": ["ranking_name", "rank", "academic_year"],
        "edge_cases": [5]  # Sources contradictoires
    },
    "Capacity": {
        "tavily": {
            "query": "places disponibles admissions {program} {school} {campus} 2025",
            "include_domains": ["{official_domain}", "concours-sesame.net", "concours-acces.com"],
            "include_raw_content": True,
            "search_depth": "basic",
            "max_results": 3
        },
        "gemma_model": "models/gemma-4-31b-it",
        "required_json_keys": ["spots_available", "academic_year"],
        "edge_cases": []
    },
    "SchoolStats": {
        "tavily": {
            "query": "chiffres clés {school} étudiants alumni partenaires",
            "include_domains": ["{official_domain}"],
            "include_raw_content": True,
            "search_depth": "basic",
            "max_results": 3
        },
        "gemma_model": "models/gemma-4-31b-it",
        "required_json_keys": ["academic_year"],
        "edge_cases": []
    },
    "Accreditation": {
        "tavily": {
            "query": "accréditations EQUIS AACSB AMBA {school}",
            "include_domains": ["{official_domain}", "lefigaro.fr", "letudiant.fr"],
            "include_raw_content": True,
            "search_depth": "basic",
            "max_results": 3
        },
        "gemma_model": "models/gemma-4-31b-it",
        "required_json_keys": ["accreditation_name", "is_active"],
        "edge_cases": []
    }
}
