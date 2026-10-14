"""
backend/db.py — Connexion PostgreSQL avec pool de connexions (Étape 4.1)

Utilise psycopg2 avec un ThreadedConnectionPool pour éviter d'ouvrir une
connexion par requête (optimisation Free Tier Neon).

Pilote (`DB_DRIVER`, poste local seulement, jamais sur Vercel) :
  - absente : psycopg2 se connecte directement à `DATABASE_URL` (port 5432) ;
  - `neon-ws` : psycopg2 passe par un pont local qui transporte le protocole
    PostgreSQL dans `wss://<hôte neon>/v2` (port 443). Voir
    backend/neon_ws_bridge.py. Le réseau de l'établissement ferme le 5432.

Référence : task.md §4.1, architecture.md §2.3 et §10.8,
docs/features/backend-local.md étape 2.1
"""

import os
import logging
import threading
import psycopg2
from psycopg2 import pool
from contextlib import contextmanager
from urllib.parse import unquote, urlsplit, urlunsplit

logger = logging.getLogger("pipeline.db")

# ── Pilote ────────────────────────────────────────────────────────

DB_DRIVER_NEON_WS = "neon-ws"
SUPPORTED_DB_DRIVERS = (DB_DRIVER_NEON_WS,)

# Paramètres d'URL qui pourraient détourner psycopg2 hors du pont. Le segment
# psycopg2 ↔ pont est en clair : il doit rester sur 127.0.0.1.
_BRIDGE_BYPASS_PARAMS = ("host", "hostaddr", "port")
# Remplacés par `sslmode=disable` : le chiffrement est celui de wss.
_TLS_PARAMS = ("sslmode", "channel_binding")


def _normalize_driver(driver: str | None) -> str | None:
    """`None`, vide ou blanc → None ; sinon la valeur en minuscules."""
    if driver is None:
        return None
    value = driver.strip().lower()
    return value or None


def _driver_label(driver: str | None) -> str:
    return driver or "psycopg2 direct"


def _host_of(database_url: str) -> str:
    """L'hôte seul, sans identifiants : la seule chose qu'on journalise."""
    try:
        return urlsplit(database_url).hostname or "(hôte inconnu)"
    except ValueError:
        return "(URL illisible)"


def _redact(text: str, database_url: str) -> str:
    """Retire d'un message l'URL de connexion et le mot de passe (encodé ou non)."""
    secrets = [database_url]
    try:
        password = urlsplit(database_url).password
    except ValueError:
        password = None
    if password:
        secrets += [password, unquote(password)]
    for secret in sorted(secrets, key=len, reverse=True):
        text = text.replace(secret, "***")
    return text


def build_dsn(database_url: str, driver: str | None, bridge_port: int | None = None) -> str:
    """
    DSN donné à psycopg2, selon le pilote. Fonction pure.

    - Pilote absent (ou vide) : `database_url` inchangée.
    - `neon-ws` : hôte `127.0.0.1` et port du pont, `sslmode=disable`, sans
      `channel_binding`. Utilisateur, mot de passe (encodage %XX compris), base
      et autres paramètres sont recopiés tels quels.
    - Toute autre valeur : `RuntimeError`, sans repli silencieux.

    Aucun message d'erreur ne cite l'URL ni le mot de passe.
    """
    normalized = _normalize_driver(driver)
    if normalized is None:
        return database_url
    if normalized not in SUPPORTED_DB_DRIVERS:
        raise RuntimeError(
            f"DB_DRIVER={driver.strip()!r} inconnu. Valeurs acceptées : "
            f"{', '.join(SUPPORTED_DB_DRIVERS)}, ou variable absente "
            "(connexion directe en 5432)."
        )
    if bridge_port is None:
        raise RuntimeError("DB_DRIVER=neon-ws : port du pont local manquant.")

    parts = urlsplit(database_url)
    if parts.scheme not in ("postgres", "postgresql") or "@" not in parts.netloc:
        raise RuntimeError(
            "DB_DRIVER=neon-ws : DATABASE_URL doit être une URL "
            "postgresql://utilisateur:motdepasse@hôte/base."
        )

    kept: list[str] = []
    for item in parts.query.split("&") if parts.query else []:
        key = unquote(item.split("=", 1)[0]).strip().lower()
        if key in _BRIDGE_BYPASS_PARAMS:
            raise RuntimeError(
                f"DB_DRIVER=neon-ws : le paramètre d'URL {key!r} n'est pas pris en "
                "charge, car il détournerait la connexion hors du pont local."
            )
        if key in _TLS_PARAMS:
            continue
        # Recopié brut : réencoder changerait la forme de certaines valeurs
        # (libpq ne lit pas « + » comme une espace).
        kept.append(item)
    kept.append("sslmode=disable")

    # Les identifiants sont recopiés à l'octet près : tout ce qui précède le
    # dernier « @ » du netloc.
    userinfo = parts.netloc.rpartition("@")[0]
    netloc = f"{userinfo}@127.0.0.1:{bridge_port}"
    return urlunsplit((parts.scheme, netloc, parts.path, "&".join(kept), parts.fragment))

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

        raw_driver = os.environ.get("DB_DRIVER")
        driver = _normalize_driver(raw_driver)
        host = _host_of(database_url)
        bridge_port = None
        if driver == DB_DRIVER_NEON_WS:
            # Importé seulement ici : sans DB_DRIVER, le pont (et websockets)
            # ne sont jamais chargés.
            from backend import neon_ws_bridge

            bridge_port = neon_ws_bridge.start_bridge(host)
        # Lève sur une valeur inconnue, avant toute connexion.
        dsn = build_dsn(database_url, raw_driver, bridge_port)

        logger.info(
            "Initialisation du pool de connexions PostgreSQL (Neon, pilote : %s, hôte : %s)...",
            _driver_label(driver), host,
        )
        try:
            _connection_pool = pool.ThreadedConnectionPool(
                minconn=1,
                maxconn=5,  # Free Tier Neon : limiter les connexions simultanées
                dsn=dsn,
                connect_timeout=15,  # 15s max pour tolérer le cold start de Neon serverless
            )
        except psycopg2.Error as exc:
            # libpq recopie parfois la chaîne de connexion dans son message :
            # on le nettoie, et l'exception d'origine n'est pas chaînée.
            detail = _redact(_redact(str(exc).strip(), dsn), database_url)
            raise RuntimeError(
                f"Connexion PostgreSQL impossible (pilote : {_driver_label(driver)}, "
                f"hôte : {host}) : {type(exc).__name__}: {detail}"
            ) from None
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
