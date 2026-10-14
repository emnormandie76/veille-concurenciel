"""
Le choix du pilote PostgreSQL du backend : `DB_DRIVER`, `build_dsn()` et le
pont WebSocket local (`backend/neon_ws_bridge.py`).

Le réseau de l'établissement ne laisse sortir que les ports 80 et 443 : le
5432 de Neon y est fermé. Avec `DB_DRIVER=neon-ws`, psycopg2 se connecte en
clair à un pont sur `127.0.0.1`, qui transporte les octets dans
`wss://<hôte neon>/v2`. Ces tests tiennent :

- sans pilote, rien ne change, et le pont n'est même pas importé ;
- avec `neon-ws`, le DSN pointe sur le pont, sans TLS ni `channel_binding`, et
  garde le reste tel quel, mot de passe encodé compris ;
- une valeur inconnue lève une erreur qui ne cite pas le mot de passe ;
- le pont recopie les octets dans les deux sens, ferme un côté quand l'autre
  se ferme, et n'écoute que sur `127.0.0.1`.

Aucun test ne sort de la machine : le « Neon » du pont est un faux serveur
WebSocket d'écho sur `127.0.0.1`. Voir docs/features/backend-local.md, étape 2.1.
"""

import asyncio
import logging
import socket
import sys
from urllib.parse import parse_qsl, unquote, urlsplit

import psycopg2
import pytest
from websockets.asyncio.server import serve

from backend import db

BRIDGE_MODULE = "backend.neon_ws_bridge"
NEON_HOST = "ep-test-123-pooler.eu-west-2.aws.neon.tech"
# Mot de passe à caractères spéciaux, encodé en %XX comme dans une vraie URL.
RAW_PASSWORD = "p@ss/w0rd!#"
ENCODED_PASSWORD = "p%40ss%2Fw0rd%21%23"
DATABASE_URL = (
    f"postgresql://neondb_owner:{ENCODED_PASSWORD}@{NEON_HOST}/neondb"
    "?sslmode=require&channel_binding=require"
    "&application_name=veille&options=endpoint%3Dep-test-123"
)


def _query(dsn: str) -> dict[str, str]:
    return dict(parse_qsl(urlsplit(dsn).query, keep_blank_values=True))


def _assert_no_secret(text: str) -> None:
    assert ENCODED_PASSWORD not in text
    assert RAW_PASSWORD not in text
    assert DATABASE_URL not in text


# ── build_dsn ─────────────────────────────────────────────────────


@pytest.mark.parametrize("driver", [None, "", "   "])
def test_build_dsn_without_driver_returns_url_unchanged(driver):
    assert db.build_dsn(DATABASE_URL, driver) == DATABASE_URL


def test_build_dsn_neon_ws_points_at_local_bridge():
    dsn = db.build_dsn(DATABASE_URL, "neon-ws", bridge_port=54321)
    parts = urlsplit(dsn)

    assert parts.scheme == "postgresql"
    assert parts.hostname == "127.0.0.1"
    assert parts.port == 54321
    assert parts.path == "/neondb"
    # Identifiants recopiés à l'octet près : l'encodage %XX est préservé.
    assert parts.username == "neondb_owner"
    assert parts.password == ENCODED_PASSWORD
    assert unquote(parts.password) == RAW_PASSWORD

    query = _query(dsn)
    assert query["sslmode"] == "disable"
    assert "channel_binding" not in query
    # Les autres paramètres sont gardés, et dans leur forme d'origine.
    assert query["application_name"] == "veille"
    assert "options=endpoint%3Dep-test-123" in parts.query
    assert parts.query.count("sslmode=") == 1


def test_build_dsn_neon_ws_adds_sslmode_when_absent():
    url = f"postgresql://u:{ENCODED_PASSWORD}@{NEON_HOST}/neondb"
    dsn = db.build_dsn(url, "neon-ws", bridge_port=6000)
    assert _query(dsn) == {"sslmode": "disable"}
    assert urlsplit(dsn).netloc == f"u:{ENCODED_PASSWORD}@127.0.0.1:6000"


def test_build_dsn_accepts_driver_case_and_spaces():
    dsn = db.build_dsn(DATABASE_URL, " NEON-WS ", bridge_port=6000)
    assert urlsplit(dsn).hostname == "127.0.0.1"


def test_build_dsn_unknown_driver_raises_without_password():
    with pytest.raises(RuntimeError) as excinfo:
        db.build_dsn(DATABASE_URL, "neon-http")
    message = str(excinfo.value)
    assert "neon-http" in message
    assert "neon-ws" in message  # la valeur attendue est nommée
    _assert_no_secret(message)


def test_build_dsn_neon_ws_requires_bridge_port():
    with pytest.raises(RuntimeError) as excinfo:
        db.build_dsn(DATABASE_URL, "neon-ws")
    _assert_no_secret(str(excinfo.value))


@pytest.mark.parametrize("param", ["host=evil.example", "hostaddr=10.0.0.1", "port=5432"])
def test_build_dsn_neon_ws_refuses_query_that_would_bypass_the_bridge(param):
    # Le segment pont ↔ psycopg2 est en clair : un paramètre qui détournerait
    # la connexion hors de 127.0.0.1 y enverrait le mot de passe en clair.
    url = f"{DATABASE_URL}&{param}"
    with pytest.raises(RuntimeError) as excinfo:
        db.build_dsn(url, "neon-ws", bridge_port=6000)
    _assert_no_secret(str(excinfo.value))


def test_build_dsn_neon_ws_refuses_non_url_dsn():
    dsn = f"host={NEON_HOST} user=u password={RAW_PASSWORD} dbname=neondb"
    with pytest.raises(RuntimeError) as excinfo:
        db.build_dsn(dsn, "neon-ws", bridge_port=6000)
    assert RAW_PASSWORD not in str(excinfo.value)


# ── get_pool ──────────────────────────────────────────────────────


class FakePool:
    def closeall(self):
        pass


@pytest.fixture
def pool_calls(monkeypatch):
    """Remplace le vrai pool : aucune connexion ne part."""
    calls: list[dict] = []

    def fake_pool(**kwargs):
        calls.append(kwargs)
        return FakePool()

    monkeypatch.setattr(db.pool, "ThreadedConnectionPool", fake_pool)
    monkeypatch.setattr(db, "_connection_pool", None)
    monkeypatch.setenv("DATABASE_URL", DATABASE_URL)
    monkeypatch.delenv("DB_DRIVER", raising=False)
    # Le module du pont est retiré de sys.modules le temps du test, puis remis.
    monkeypatch.delitem(sys.modules, BRIDGE_MODULE, raising=False)
    return calls


def test_get_pool_without_driver_keeps_url_and_never_imports_bridge(pool_calls):
    db.get_pool()

    assert len(pool_calls) == 1
    assert pool_calls[0]["dsn"] == DATABASE_URL
    assert BRIDGE_MODULE not in sys.modules


def test_get_pool_unknown_driver_raises_before_anything(pool_calls, monkeypatch):
    monkeypatch.setenv("DB_DRIVER", "pgbouncer")

    with pytest.raises(RuntimeError) as excinfo:
        db.get_pool()

    _assert_no_secret(str(excinfo.value))
    assert pool_calls == []
    assert BRIDGE_MODULE not in sys.modules
    assert db._connection_pool is None


def test_get_pool_neon_ws_starts_bridge_on_neon_host(pool_calls, monkeypatch):
    from backend import neon_ws_bridge

    started: list[str] = []

    def fake_start_bridge(neon_host):
        started.append(neon_host)
        return 54321

    monkeypatch.setattr(neon_ws_bridge, "start_bridge", fake_start_bridge)
    monkeypatch.setenv("DB_DRIVER", "neon-ws")

    db.get_pool()

    assert started == [NEON_HOST]
    dsn = pool_calls[0]["dsn"]
    assert urlsplit(dsn).netloc == f"neondb_owner:{ENCODED_PASSWORD}@127.0.0.1:54321"
    assert _query(dsn)["sslmode"] == "disable"


@pytest.mark.parametrize("driver", [None, "neon-ws"])
def test_get_pool_connection_failure_names_driver_never_dsn(pool_calls, monkeypatch, driver):
    if driver:
        from backend import neon_ws_bridge

        monkeypatch.setattr(neon_ws_bridge, "start_bridge", lambda neon_host: 54321)
        monkeypatch.setenv("DB_DRIVER", driver)

    def failing_pool(**kwargs):
        # libpq recopie parfois la chaîne de connexion dans son message.
        raise psycopg2.OperationalError(
            f'missing "=" after "{kwargs["dsn"]}" in connection info string'
        )

    monkeypatch.setattr(db.pool, "ThreadedConnectionPool", failing_pool)

    with pytest.raises(RuntimeError) as excinfo:
        db.get_pool()

    message = str(excinfo.value)
    _assert_no_secret(message)
    assert ("neon-ws" in message) == (driver == "neon-ws")
    assert NEON_HOST in message
    # L'exception d'origine n'est pas chaînée : sa trace reprendrait le DSN.
    assert excinfo.value.__cause__ is None
    assert excinfo.value.__suppress_context__ is True
    assert db._connection_pool is None


# ── Le pont ───────────────────────────────────────────────────────


def _port_of(server) -> int:
    return server.sockets[0].getsockname()[1]


def test_bridge_target_defaults_to_neon_v2_endpoint():
    from backend import neon_ws_bridge

    assert neon_ws_bridge.target_url_for(NEON_HOST) == f"wss://{NEON_HOST}/v2"


def test_bridge_copies_bytes_both_ways_and_tcp_close_closes_websocket():
    from backend import neon_ws_bridge

    async def scenario():
        received: list[bytes | str] = []
        ws_closed = asyncio.Event()

        async def echo(ws):
            try:
                async for message in ws:
                    received.append(message)
                    await ws.send(message)
            finally:
                ws_closed.set()

        async with serve(echo, "127.0.0.1", 0) as server:
            bridge = neon_ws_bridge.Bridge(f"ws://127.0.0.1:{_port_of(server)}")
            port = bridge.start()
            try:
                reader, writer = await asyncio.open_connection("127.0.0.1", port)
                # Un message de démarrage PostgreSQL commence par des octets nuls :
                # tout l'alphabet des octets doit passer.
                payload = bytes(range(256)) * 64
                writer.write(payload)
                await writer.drain()
                echoed = await asyncio.wait_for(reader.readexactly(len(payload)), 5)
                assert echoed == payload
                # Trames binaires, octets intacts.
                assert all(isinstance(m, bytes) for m in received)
                assert b"".join(received) == payload

                # psycopg2 ferme sa socket : le pont ferme le WebSocket.
                writer.close()
                await writer.wait_closed()
                await asyncio.wait_for(ws_closed.wait(), 5)
            finally:
                bridge.stop()

    asyncio.run(scenario())


def test_bridge_websocket_close_closes_tcp_side():
    from backend import neon_ws_bridge

    async def scenario():
        async def say_bye(ws):
            await ws.send(b"bye")
            await ws.close()

        async with serve(say_bye, "127.0.0.1", 0) as server:
            bridge = neon_ws_bridge.Bridge(f"ws://127.0.0.1:{_port_of(server)}")
            port = bridge.start()
            try:
                reader, writer = await asyncio.open_connection("127.0.0.1", port)
                data = await asyncio.wait_for(reader.read(), 5)  # jusqu'à EOF
                assert data == b"bye"
                writer.close()
            finally:
                bridge.stop()

    asyncio.run(scenario())


def test_bridge_connection_error_logs_host_and_closes_tcp(caplog):
    from backend import neon_ws_bridge

    # Un port local fermé : la connexion WebSocket échoue aussitôt.
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        dead_port = probe.getsockname()[1]

    async def scenario():
        bridge = neon_ws_bridge.Bridge(
            f"ws://127.0.0.1:{dead_port}", host_label="ep-dead.example"
        )
        port = bridge.start()
        try:
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            assert await asyncio.wait_for(reader.read(), 10) == b""
            writer.close()
        finally:
            bridge.stop()

    with caplog.at_level(logging.WARNING, logger="pipeline.neon_ws_bridge"):
        asyncio.run(scenario())

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings, "l'échec de connexion doit être journalisé en WARNING"
    assert any("ep-dead.example" in r.getMessage() for r in warnings)
    assert all(f"ws://127.0.0.1:{dead_port}" not in r.getMessage() for r in warnings)


def test_bridge_listens_on_loopback_only():
    from backend import neon_ws_bridge

    bridge = neon_ws_bridge.Bridge("ws://127.0.0.1:9")
    port = bridge.start()
    try:
        addresses = bridge.listen_addresses()
        assert addresses == [("127.0.0.1", port)]
    finally:
        bridge.stop()


def test_bridge_uses_configured_port(monkeypatch):
    from backend import neon_ws_bridge

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        free_port = probe.getsockname()[1]

    monkeypatch.setenv("NEON_WS_BRIDGE_PORT", str(free_port))
    assert neon_ws_bridge.configured_port() == free_port

    monkeypatch.delenv("NEON_WS_BRIDGE_PORT")
    assert neon_ws_bridge.configured_port() == 0


@pytest.mark.parametrize("raw", ["abc", "0", "70000", "-1"])
def test_bridge_invalid_configured_port_raises(monkeypatch, raw):
    from backend import neon_ws_bridge

    monkeypatch.setenv("NEON_WS_BRIDGE_PORT", raw)
    with pytest.raises(RuntimeError):
        neon_ws_bridge.configured_port()


def test_start_bridge_runs_once_per_process(monkeypatch):
    from backend import neon_ws_bridge

    monkeypatch.delenv("NEON_WS_BRIDGE_PORT", raising=False)
    neon_ws_bridge.stop_bridge()
    try:
        first = neon_ws_bridge.start_bridge(NEON_HOST, target_url="ws://127.0.0.1:9")
        second = neon_ws_bridge.start_bridge(NEON_HOST, target_url="ws://127.0.0.1:9")
        assert first == second
        # Un autre hôte dans le même processus : refus explicite, pas de
        # second pont ni de bascule silencieuse.
        with pytest.raises(RuntimeError):
            neon_ws_bridge.start_bridge("ep-other.example", target_url="ws://127.0.0.1:9")
    finally:
        neon_ws_bridge.stop_bridge()
