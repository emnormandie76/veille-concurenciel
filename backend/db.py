"""
backend/db.py — Connexion PostgreSQL avec pool de connexions (Étape 4.1)

Utilise psycopg2 avec un SimpleConnectionPool pour éviter d'ouvrir une
connexion par requête (optimisation Free Tier Neon).

Référence : task.md §4.1, architecture.md §2.3
"""

import os
import logging
import psycopg2
from psycopg2 import pool
from contextlib import contextmanager

logger = logging.getLogger("pipeline.db")

# ── Pool de connexions (lazy init) ────────────────────────────────

_connection_pool: pool.SimpleConnectionPool | None = None


def get_pool() -> pool.SimpleConnectionPool:
    """Retourne le pool de connexions (crée si nécessaire)."""
    global _connection_pool
    if _connection_pool is None:
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            raise RuntimeError("DATABASE_URL non définie dans les variables d'environnement")

        logger.info("Initialisation du pool de connexions PostgreSQL (Neon)...")
        _connection_pool = pool.SimpleConnectionPool(
            minconn=1,
            maxconn=5,  # Free Tier Neon : limiter les connexions simultanées
            dsn=database_url,
            connect_timeout=5,  # 5s max pour éviter le blocage (Edge Case 15)
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
    if _connection_pool is not None:
        _connection_pool.closeall()
        _connection_pool = None
        logger.info("Pool de connexions PostgreSQL fermé.")
