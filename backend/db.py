"""
backend/db.py — Connexion PostgreSQL avec pool de connexions (Étape 4.1)

Utilise psycopg2 avec un ThreadedConnectionPool pour éviter d'ouvrir une
connexion par requête (optimisation Free Tier Neon).

Référence : task.md §4.1, architecture.md §2.3
"""

import os
import logging
import threading
import psycopg2
from psycopg2 import pool
from contextlib import contextmanager

logger = logging.getLogger("pipeline.db")

# ── Pool de connexions (lazy init) ────────────────────────────────
#
# Le pool est sollicité depuis plusieurs threads : ceux de run_in_executor()
# (endpoints /internal) et ceux d'APScheduler (cron).
#
# 1. L'initialisation était un simple test `is None` sans verrou. Deux entrées
#    simultanées à froid construisaient chacune leur pool : jusqu'à dix
#    connexions ouvertes sur un palier Neon qui en autorise cinq, et le premier
#    pool restait ouvert sans que personne n'en garde la référence. D'où le
#    double contrôle sous verrou ci-dessous.
# 2. SimpleConnectionPool n'est pas partageable entre threads : getconn() et
#    putconn() y manipulent les listes internes sans protection.
#    ThreadedConnectionPool expose la même interface et la protège d'un verrou.
#    C'est le même défaut que le point 1, un cran plus bas.

_connection_pool: pool.ThreadedConnectionPool | None = None
_pool_lock = threading.Lock()


def get_pool() -> pool.ThreadedConnectionPool:
    """Retourne le pool de connexions (crée si nécessaire). Thread-safe."""
    global _connection_pool
    # Premier contrôle hors verrou : une fois le pool construit, le chemin
    # normal ne prend aucun verrou.
    if _connection_pool is not None:
        return _connection_pool

    with _pool_lock:
        # Second contrôle sous verrou : un autre thread a pu construire le pool
        # pendant l'attente.
        if _connection_pool is not None:
            return _connection_pool

        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            raise RuntimeError("DATABASE_URL non définie dans les variables d'environnement")

        logger.info("Initialisation du pool de connexions PostgreSQL (Neon)...")
        _connection_pool = pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=5,  # Free Tier Neon : limiter les connexions simultanées
            dsn=database_url,
            connect_timeout=15,  # 15s max pour tolérer le cold start de Neon serverless
        )
        logger.info("✅ Pool PostgreSQL initialisé (1–5 connexions)")

    return _connection_pool


@contextmanager
def get_db_connection():
    """
    Context manager pour obtenir une connexion depuis le pool.
    Remet la connexion dans le pool après utilisation (même en cas d'erreur).

    Usage:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
    """
    connection_pool = get_pool()
    conn = connection_pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        connection_pool.putconn(conn)


def check_db_connection() -> bool:
    """
    Vérifie que la connexion à la BDD fonctionne.
    Utilisé par le healthcheck et le endpoint pipeline-status.
    """
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        return True
    except Exception as e:
        logger.error(f"❌ Erreur de connexion BDD: {e}")
        return False


def close_pool():
    """Ferme le pool proprement (appelé au shutdown FastAPI)."""
    global _connection_pool
    with _pool_lock:
        if _connection_pool is not None:
            _connection_pool.closeall()
            _connection_pool = None
            logger.info("Pool de connexions PostgreSQL fermé.")
