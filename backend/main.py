"""
School Data Pipeline — FastAPI Backend (Étape 5)

Point d'entrée du pipeline IA. Intègre :
  - db.py : Pool de connexions PostgreSQL (Neon)
  - TavilyKeyManager : Rotation automatique des clés Tavily
  - gemma_client.py : Module Gemma (retry, nettoyage JSON, validation)
  - routers/internal.py : API Interne (trigger-scan, trigger-enrichment, pipeline-status)
  - scheduler/jobs.py : APScheduler (phase1_scanner, phase2_enricher)
  - pipeline/phase1.py : Phase 1 Cartographie (Étape 5)

Étapes suivantes :
  - Étape 6 : Phase 2 (Enrichissement) — run_phase2()
  - Étape 7 : Traitement Crowdsourcing
"""

import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Charger les variables d'environnement (cherche backend/.env relatif à ce fichier)
backend_env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(backend_env_path):
    load_dotenv(backend_env_path)
else:
    load_dotenv()


# ── Configuration du logging ──────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("pipeline.main")

# ── Singleton TavilyKeyManager ─────────────────────────────────────
# Accessible par tous les modules via app.state.tavily_manager
from backend.tavily_service.key_manager import TavilyKeyManager, QuotaExhaustedError


# ── Lifespan (startup / shutdown) ─────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialise les ressources au démarrage, les libère à l'arrêt."""
    # ── Startup ───────────────────────────────────────────────────
    logger.info("🚀 Démarrage du backend School Data Pipeline...")

    # Le pool BDD est lazy — il s'initialise à la première requête
    # (évite le blocage au démarrage si Neon est lent)
    logger.info("✅ Pool PostgreSQL (Neon) : mode lazy init")

    # Initialiser TavilyKeyManager
    try:
        app.state.tavily_manager = TavilyKeyManager()
        logger.info(
            f"✅ TavilyKeyManager prêt ({app.state.tavily_manager.total_keys} clé(s))"
        )
    except Exception as e:
        logger.warning(f"⚠️ TavilyKeyManager non initialisé: {e}")
        app.state.tavily_manager = None

    # Démarrer APScheduler (Phase 1 + Phase 2)
    try:
        from backend.scheduler.jobs import start_scheduler
        start_scheduler(app.state.tavily_manager)
    except Exception as e:
        logger.warning(f"⚠️ Scheduler non démarré: {e}")

    logger.info("✅ Backend prêt")

    yield  # L'application tourne ici

    # ── Shutdown ──────────────────────────────────────────────────
    logger.info("🛑 Arrêt du backend...")
    try:
        from backend.scheduler.jobs import stop_scheduler
        stop_scheduler()
    except Exception:
        pass
    try:
        from backend.db import close_pool
        close_pool()
    except Exception:
        pass
    logger.info("✅ Arrêt propre")


# ── Application FastAPI ───────────────────────────────────────────

app = FastAPI(
    title="School Data Pipeline — Backend IA",
    description=(
        "Pipeline IA automatisé pour la centralisation des données "
        "de l'enseignement supérieur français."
    ),
    version="0.5.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ──────────────────────────────────────────────────────────
# En production, remplacer par l'URL Vercel/Koyeb
ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS", "http://localhost:3000"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────
from backend.routers.internal import router as internal_router
app.include_router(internal_router)


# ── Endpoints publics ─────────────────────────────────────────────

@app.get("/health", tags=["Système"])
async def health_check():
    """
    Healthcheck endpoint.
    Utilisé par Koyeb pour vérifier que le backend est opérationnel (Edge Case 15).
    Retourne toujours 200 même si la BDD est temporairement indisponible.
    Ne fait PAS de check BDD (évite le timeout au démarrage).
    """
    return {
        "status": "ok",
        "version": "0.4.0",
    }
