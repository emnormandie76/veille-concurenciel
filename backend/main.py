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

# ── Environnement ─────────────────────────────────────────────────
# Pilote ce qui ne doit exister qu en developpement : documentation OpenAPI,
# origines CORS de repli.
ENVIRONMENT = os.environ.get("ENVIRONMENT", "development").strip().lower()
IS_PRODUCTION = ENVIRONMENT in ("production", "prod")

# Source unique : le healthcheck annoncait 0.4.0 pendant que l app declarait 0.5.0.
APP_VERSION = "0.5.0"

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

    # Jobs laissés « running » par le processus précédent. Sans cette reprise,
    # un redémarrage en cours de job verrouillait l'école concernée pour
    # toujours : la garde de concurrence voyait un job actif que plus personne
    # ne ferait avancer. Suppose un seul worker backend à la fois — voir
    # backend/pipeline_jobs.py.
    try:
        from backend import pipeline_jobs
        pipeline_jobs.reap_orphaned_jobs()
        pipeline_jobs.purge_finished_jobs()
    except Exception as e:
        logger.warning(f"⚠️ Reprise de l'état des jobs impossible: {e}")

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
    version=APP_VERSION,
    lifespan=lifespan,
    # Fermes en production : la documentation publiait la surface complete de
    # l API interne, routes /internal/* comprises. openapi_url doit etre ferme
    # aussi, sinon le schema reste telechargeable et /docs reconstructible.
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
)

# ── CORS ──────────────────────────────────────────────────────────
# En production, remplacer par l'URL Vercel/Koyeb
_origins_env = os.environ.get("ALLOWED_ORIGINS", "").strip()

if _origins_env:
    ALLOWED_ORIGINS = [o.strip() for o in _origins_env.split(",") if o.strip()]
elif IS_PRODUCTION:
    # Le repli http://localhost:3000 partait tel quel en production quand la
    # variable n etait pas fixee. Aucune origine plutot qu une mauvaise :
    # les appels serveur a serveur (Next.js -> FastAPI) ne passent pas par CORS.
    ALLOWED_ORIGINS = []
    logger.error(
        "ALLOWED_ORIGINS non definie en production : aucune origine croisee "
        "ne sera acceptee."
    )
else:
    ALLOWED_ORIGINS = ["http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    # Restreint a ce que l API expose reellement, au lieu de ["*"].
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
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
        "version": APP_VERSION,
    }
