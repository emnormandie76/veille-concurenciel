"""
School Data Pipeline — FastAPI Backend

Point d'entrée du pipeline IA, lancé à la main sur le poste de l'admin
(`uvicorn backend.main:app`, sur 127.0.0.1 seulement). Intègre :
  - db.py : Pool de connexions PostgreSQL (Neon), direct ou par le pont
    WebSocket (DB_DRIVER=neon-ws)
  - TavilyKeyManager : Rotation automatique des clés Tavily
  - routers/internal.py : API Interne (recherches, passes dues, pipeline-status)
  - scheduler/jobs.py : APScheduler (traitement des contributions) et passes
    dues lancées sur demande (run_due_passes)

Un démarrage raté ne se cache pas : chaque échec est journalisé en ERROR et
s'ajoute à `app.state.startup_errors`, que `/health` et pipeline-status
exposent (F3, docs/features/backend-local.md étape 3).
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

# Source unique : le healthcheck annoncait 0.4.0 pendant que l app declarait 0.5.0.
APP_VERSION = "0.5.0"

# Le seul client du backend est le Next.js local (`npm run dev`). Les appels
# serveur à serveur (Next.js → FastAPI) ne passent pas par CORS.
ALLOWED_ORIGINS = ["http://localhost:3000"]

# ── Singleton TavilyKeyManager ─────────────────────────────────────
# Accessible par tous les modules via app.state.tavily_manager
from backend.tavily_service.key_manager import TavilyKeyManager, QuotaExhaustedError


# ── Lifespan (startup / shutdown) ─────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialise les ressources au démarrage, les libère à l'arrêt."""
    # ── Startup ───────────────────────────────────────────────────
    logger.info("🚀 Démarrage du backend School Data Pipeline...")
    app.state.startup_errors = []
    app.state.tavily_manager = None

    def startup_error(step: str, error) -> None:
        message = f"{step} : {error}"
        logger.error(f"❌ {message}")
        app.state.startup_errors.append(message)

    # La base d'abord : le message de get_pool() cite le pilote et l'hôte, et
    # db_connection_error() y ajoute une piste selon DB_DRIVER. Avec
    # DB_DRIVER=neon-ws, c'est ici que le pont WebSocket démarre.
    from backend.db import db_connection_error
    db_error = db_connection_error()
    if db_error:
        startup_error("Base de données", db_error)

    # Jobs laissés « running » par le processus précédent. Sans cette reprise,
    # un redémarrage en cours de job verrouillait l'école concernée pour
    # toujours : la garde de concurrence voyait un job actif que plus personne
    # ne ferait avancer. Suppose un seul worker backend à la fois — voir
    # backend/pipeline_jobs.py. Base injoignable : pas d'essai, chacun
    # attendrait le délai de connexion pour la même erreur ; les jobs morts
    # seront clos au battement de cœur (reap_stale_jobs).
    if db_error is None:
        try:
            from backend import pipeline_jobs
            pipeline_jobs.reap_orphaned_jobs()
            pipeline_jobs.purge_finished_jobs()
        except Exception as e:
            startup_error("Reprise de l'état des jobs", e)

    # Initialiser TavilyKeyManager
    try:
        app.state.tavily_manager = TavilyKeyManager()
        logger.info(
            f"✅ TavilyKeyManager prêt ({app.state.tavily_manager.total_keys} clé(s))"
        )
    except Exception as e:
        startup_error("Gestionnaire de clés Tavily", e)
        app.state.tavily_manager = None

    # Démarrer APScheduler (traitement des contributions)
    try:
        from backend.scheduler.jobs import start_scheduler
        start_scheduler(app.state.tavily_manager)
    except Exception as e:
        startup_error("Scheduler", e)

    if app.state.startup_errors:
        logger.error(
            f"⚠️ Backend démarré avec {len(app.state.startup_errors)} erreur(s) : "
            "voir /health et pipeline-status"
        )
    else:
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
    # /docs, /redoc et /openapi.json restent ouverts : le service n'écoute que
    # sur 127.0.0.1 (décision D5, backend-local.md). Ne jamais le lancer avec
    # --host 0.0.0.0.
)

# ── CORS ──────────────────────────────────────────────────────────
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
    Healthcheck endpoint : la sonde de disponibilité du backend, sans jeton.

    `degraded`, avec la liste des erreurs, si le démarrage a échoué en partie
    (base injoignable, aucune clé Tavily, scheduler arrêté…). Toujours 200 :
    le processus répond, c'est le corps qui dit s'il est utilisable. Ne refait
    PAS de contrôle de la base (pipeline-status s'en charge).
    """
    errors = list(getattr(app.state, "startup_errors", []))
    if errors:
        return {"status": "degraded", "version": APP_VERSION, "errors": errors}
    return {
        "status": "ok",
        "version": APP_VERSION,
    }
