"""
backend/neon_ws_bridge.py — Pont local TCP ↔ WebSocket vers Neon (DB_DRIVER=neon-ws)

Le réseau de l'établissement ne laisse sortir que les ports 80 et 443 : le 5432
de Neon y est fermé. Neon expose aussi un proxy WebSocket, `wss://<hôte>/v2`
(port 443), qui transporte le protocole PostgreSQL brut. Ce pont écoute sur
`127.0.0.1`, et pour chaque connexion de psycopg2 il ouvre un WebSocket vers
Neon et recopie les octets dans les deux sens. Le code SQL ne change pas.

Montage éprouvé par la sonde du 14 octobre 2026 (plan backend-local, étape 0),
repris tel quel :
  - `connect(f"wss://{host}/v2", max_size=None, compression=None, open_timeout=20)` ;
  - les octets TCP partent tels quels en trames binaires, chaque message reçu
    est réécrit sur la socket ;
  - côté psycopg2 : `sslmode=disable`, sans `channel_binding` (voir
    `build_dsn()` dans backend/db.py). Le chiffrement est celui de `wss`.

Le segment psycopg2 ↔ pont est donc EN CLAIR, et Neon peut y demander le mot de
passe en clair : le pont n'écoute que sur 127.0.0.1, jamais sur une autre
adresse. Ce module n'est importé que si `DB_DRIVER=neon-ws` (backend/db.py).

Décision D1 du plan : le pont vit dans le processus Python. `uvicorn` suffit,
et les scripts de backend/scripts/ en profitent sans rien faire.

Référence : docs/features/backend-local.md §4 et étape 2.1,
architecture.md §10.8.
"""

import asyncio
import logging
import os
import threading

from websockets.asyncio.client import connect

logger = logging.getLogger("pipeline.neon_ws_bridge")

LOOPBACK_HOST = "127.0.0.1"
PORT_ENV = "NEON_WS_BRIDGE_PORT"
_READ_CHUNK = 65536
_START_TIMEOUT_SECONDS = 10


def target_url_for(neon_host: str) -> str:
    """URL du proxy WebSocket de Neon pour un hôte donné."""
    return f"wss://{neon_host}/v2"


def configured_port() -> int:
    """Port d'écoute : `NEON_WS_BRIDGE_PORT`, ou 0 (port libre choisi par l'OS)."""
    raw = os.environ.get(PORT_ENV, "").strip()
    if not raw:
        return 0
    try:
        port = int(raw)
    except ValueError:
        port = -1
    if not 1 <= port <= 65535:
        # Pas de repli silencieux : un port mal saisi doit se voir.
        raise RuntimeError(
            f"{PORT_ENV} invalide ({raw!r}) : entier attendu entre 1 et 65535, "
            "ou variable absente pour un port libre."
        )
    return port


class Bridge:
    """
    Un pont TCP ↔ WebSocket, dans sa propre boucle asyncio et son propre fil.

    `target_url` est l'URL WebSocket à joindre : celle de Neon en service,
    celle d'un faux serveur local dans les tests. `host_label` est ce que les
    journaux en disent : l'hôte, jamais l'URL complète.
    """

    def __init__(self, target_url: str, *, port: int = 0, host_label: str | None = None):
        self.target_url = target_url
        self.host_label = host_label or target_url
        self._requested_port = port
        self._ready = threading.Event()
        self._startup_error: BaseException | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._server: asyncio.Server | None = None
        self._thread: threading.Thread | None = None
        self.port: int | None = None

    def start(self) -> int:
        """Démarre le pont et rend son port d'écoute. Lève si l'écoute échoue."""
        self._thread = threading.Thread(
            target=self._run, name="neon-ws-bridge", daemon=True
        )
        self._thread.start()
        if not self._ready.wait(_START_TIMEOUT_SECONDS):
            raise RuntimeError("Pont Neon : démarrage trop long, abandon.")
        if self._startup_error is not None:
            raise RuntimeError(
                f"Pont Neon : écoute impossible sur {LOOPBACK_HOST}:{self._requested_port} "
                f"({type(self._startup_error).__name__}: {self._startup_error})"
            ) from None
        assert self.port is not None
        return self.port

    def listen_addresses(self) -> list[tuple[str, int]]:
        """Adresses réellement liées par le serveur (hôte, port)."""
        if self._server is None:
            return []
        return [tuple(s.getsockname()[:2]) for s in self._server.sockets]

    def stop(self) -> None:
        """Arrête le pont et ferme les connexions en cours."""
        loop = self._loop
        if loop is None or not loop.is_running():
            return
        asyncio.run_coroutine_threadsafe(self._shutdown(), loop).result(
            _START_TIMEOUT_SECONDS
        )
        # Arrêtée d'ici, et non dans _shutdown() : la boucle doit encore
        # transmettre le résultat de _shutdown() à ce fil.
        loop.call_soon_threadsafe(loop.stop)
        if self._thread is not None:
            self._thread.join(_START_TIMEOUT_SECONDS)

    # ── Boucle du pont ────────────────────────────────────────────

    def _run(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop
        try:
            self._server = loop.run_until_complete(
                asyncio.start_server(
                    self._handle, host=LOOPBACK_HOST, port=self._requested_port
                )
            )
            self.port = self._server.sockets[0].getsockname()[1]
        except BaseException as exc:  # noqa: BLE001 — remonté par start()
            self._startup_error = exc
            self._ready.set()
            loop.close()
            return
        self._ready.set()
        try:
            loop.run_forever()
        finally:
            loop.close()

    async def _shutdown(self) -> None:
        if self._server is not None:
            self._server.close()
        current = asyncio.current_task()
        tasks = [t for t in asyncio.all_tasks() if t is not current]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        """Une connexion psycopg2 : un WebSocket vers Neon, recopie dans les deux sens."""
        try:
            ws = await connect(
                self.target_url, max_size=None, compression=None, open_timeout=20
            )
        except Exception as exc:  # noqa: BLE001 — journalisé, socket fermée
            logger.warning(
                "Pont Neon : connexion WebSocket impossible vers %s (%s: %s)",
                self.host_label, type(exc).__name__, exc,
            )
            writer.close()
            return

        async def tcp_to_ws() -> None:
            while True:
                data = await reader.read(_READ_CHUNK)
                if not data:  # psycopg2 a fermé sa socket
                    return
                await ws.send(data)  # bytes → trame binaire

        async def ws_to_tcp() -> None:
            async for message in ws:  # s'arrête à la fermeture du WebSocket
                writer.write(message if isinstance(message, bytes) else message.encode())
                await writer.drain()

        tasks = [asyncio.create_task(tcp_to_ws()), asyncio.create_task(ws_to_tcp())]
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                exc = task.exception()
                if exc is not None:
                    logger.warning(
                        "Pont Neon : connexion interrompue avec %s (%s: %s)",
                        self.host_label, type(exc).__name__, exc,
                    )
        finally:
            # La fermeture d'un côté ferme l'autre.
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await ws.close()
            writer.close()


# ── Pont unique du processus ──────────────────────────────────────

_bridge: Bridge | None = None
_bridge_host: str | None = None
_bridge_lock = threading.Lock()


def start_bridge(neon_host: str, *, target_url: str | None = None) -> int:
    """
    Démarre le pont du processus (une seule fois) et rend son port d'écoute.

    Les appels suivants rendent le même port. Un autre hôte dans le même
    processus est refusé : un seul pont, une seule base. `target_url` remplace
    `wss://{neon_host}/v2` (tests).
    """
    global _bridge, _bridge_host
    with _bridge_lock:
        if _bridge is not None:
            if neon_host != _bridge_host:
                raise RuntimeError(
                    f"Pont Neon déjà démarré vers {_bridge_host} : "
                    f"un second hôte ({neon_host}) n'est pas pris en charge."
                )
            assert _bridge.port is not None
            return _bridge.port

        bridge = Bridge(
            target_url or target_url_for(neon_host),
            port=configured_port(),
            host_label=neon_host,
        )
        port = bridge.start()
        _bridge, _bridge_host = bridge, neon_host
        logger.info(
            "✅ Pont Neon prêt : %s:%d → %s:443 (WebSocket)", LOOPBACK_HOST, port, neon_host
        )
        return port


def stop_bridge() -> None:
    """Arrête le pont du processus, s'il tourne."""
    global _bridge, _bridge_host
    with _bridge_lock:
        if _bridge is not None:
            _bridge.stop()
        _bridge, _bridge_host = None, None
