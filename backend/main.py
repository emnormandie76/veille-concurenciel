"""
School Data Pipeline — FastAPI Backend
Étape 0 : Scaffolding initial

Ce module est le point d'entrée du backend IA.
Les modules suivants seront ajoutés lors des étapes ultérieures :
  - Étape 4 : db.py, TavilyKeyManager, Module Gemma
  - Étape 5 : Phase 1 (Cartographie)
  - Étape 6 : Phase 2 (Enrichissement)
  - Étape 7 : Traitement Crowdsourcing
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="School Data Pipeline — Backend IA",
    description="Pipeline IA automatisé pour la centralisation des données de l'enseignement supérieur français.",
    version="0.1.0",
)

# CORS — autorise les appels depuis Next.js (localhost:3000 en dev)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["Système"])
async def health_check():
    """
    Healthcheck endpoint.
    Utilisé par Koyeb pour vérifier que le backend est opérationnel (Edge Case 15).
    Retourne toujours 200 quand le serveur est prêt.
    """
    return {"status": "ok"}
