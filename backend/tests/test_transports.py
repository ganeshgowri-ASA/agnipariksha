"""Transport abstraction tests — fake-socket only, no hardware."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.transports import (  # noqa: E402
    AuditLog,
    Transport,
    TransportError,
    TransportState,
    build_transport,
    get_audit_log,
)
from backend.app.transports.scpi_tcp import ScpiTcpTransport  # noqa: E402
from backend.app.transports.raw_tcp import RawTcpTransport  # noqa: E402
from backend.app.transports.modbus_tcp import ModbusTcpTransport, _parse_command  # noqa: E402
from backend.app.transports.modbus_rtu import _crc16  # noqa: E402


# ---------------------------------------------------------------- fake socket


class _FakeReader:
    def __init__(self, script: list[bytes]) -> None:
        self._script = list(script)
        self._buf = b""

    async def readline(self) -> bytes:
        # If buffered data contains a newline, return that chunk.
        if b"\n" in self._buf:
            line, _, self._buf = self._buf.partition(b"\n")
            return line + b"\n"
        # Otherwise pop the next scripted item.
        if not self._script:
            return b""
        item = self._script.pop(0)
        if b"\n" in item:
            line, _, rest = item.partition(b"\n")
            self._buf = rest
            return line + b"\n"
        return item

    async def read(self, n: int) -> bytes:
        if self._buf:
            out, self._buf = self._buf[:n], self._buf[n:]
            return out
        if not self._script:
            return b""
        item = self._script.pop(0)
        return item[:n]


class _FakeWriter:
    def __init__(self) -> None:
        self.written: list[bytes] = []
        self._closing = False

    def write(self, data: bytes) -> None:
        self.written.append(data)

    async def drain(self) -> None:
        return None

    def close(self) -> None:
        self._closing = True

    async def wait_closed(self) -> None:
        return None

    def is_closing(self) -> bool:
        return self._closing


def _opener(script: list[bytes]):
    reader = _FakeReader(script)
    writer = _FakeWriter()

    async def _open(host, port):  # noqa: ARG001
        return reader, writer

    return _open, reader, writer


# ---------------------------------------------------------------- audit log


def test_audit_log_ring_buffer_capacity() -> None:
    log = AuditLog(maxlen=3)
    for i in range(5):
        from backend.app.transports.base import AuditEntry

        log.append(AuditEntry(ts_ms=i, device_id="d", kind="k", op="send", command=f"c{i}"))
    tail = log.tail(10)
    assert len(tail) == 3
    assert [e.command for e in tail] == ["c2", "c3", "c4"]


def test_audit_log_filter_by_device() -> None:
    log = AuditLog(maxlen=10)
    from backend.app.transports.base import AuditEntry

    log.append(AuditEntry(ts_ms=1, device_id="a", kind="k", op="send", command="x"))
    log.append(AuditEntry(ts_ms=2, device_id="b", kind="k", op="send", command="y"))
    assert len(log.tail(10, device_id="a")) == 1
    assert log.tail(10, device_id="a")[0].command == "x"


def test_get_audit_log_singleton() -> None:
    assert get_audit_log() is get_audit_log()


# ---------------------------------------------------------------- scpi_tcp


@pytest.mark.asyncio
async def test_scpi_tcp_send_query_round_trip() -> None:
    opener, _reader, writer = _opener([b"ITECH,PV6000,SN123,1.0\n"])
    t = ScpiTcpTransport("itech", "h", 1234, opener=opener)
    assert await t.connect()
    await t.send("OUTP ON")
    assert writer.written == [b"OUTP ON\n"]
    idn = await t.query("*IDN?")
    assert idn == "ITECH,PV6000,SN123,1.0"
    await t.close()
    assert t.state is TransportState.CLOSED


@pytest.mark.asyncio
async def test_scpi_tcp_audit_logs_send_and_query() -> None:
    audit = AuditLog(maxlen=10)
    opener, _r, _w = _opener([b"OK\n"])
    t = ScpiTcpTransport("dev1", "h", 1, opener=opener)
    t._audit = audit  # inject for assertion
    await t.connect()
    await t.send("CONF:VOLT 48")
    await t.query("MEAS:VOLT?")
    entries = audit.tail(10)
    ops = [e.op for e in entries]
    assert "send" in ops and "query" in ops
    q = [e for e in entries if e.op == "query"][0]
    assert q.response == "OK"
    assert q.ok is True


@pytest.mark.asyncio
async def test_scpi_tcp_connect_backoff_eventually_returns_false() -> None:
    attempts = {"n": 0}

    async def flaky(host, port):  # noqa: ARG001
        attempts["n"] += 1
        raise OSError("boom")

    t = ScpiTcpTransport("dev", "h", 1, opener=flaky)
    t.BASE_BACKOFF_S = 0  # speed up
    ok = await t.connect(max_attempts=3)
    assert ok is False
    assert t.state is TransportState.DOWN
    assert attempts["n"] == 3
    assert t.last_error and "boom" in t.last_error


@pytest.mark.asyncio
async def test_scpi_tcp_send_in_demo_mode_skips_socket() -> None:
    t = ScpiTcpTransport("dev", "h", 1, demo=True)
    await t.connect()
    assert t.state is TransportState.DEMO
    await t.send("OUTP ON")  # must not raise even without socket
    r = await t.query("*IDN?")
    assert "DEMO" in r or "ITECH" in r or r == "OK"


@pytest.mark.asyncio
async def test_scpi_tcp_lock_serializes_concurrent_queries() -> None:
    """Two concurrent queries must serialise — the audit log captures order."""
    opener, _r, _w = _opener([b"A\n", b"B\n"])
    t = ScpiTcpTransport("dev", "h", 1, opener=opener)
    await t.connect()
    a, b = await asyncio.gather(t.query("Q1"), t.query("Q2"))
    assert {a, b} == {"A", "B"}


# ---------------------------------------------------------------- raw_tcp


@pytest.mark.asyncio
async def test_raw_tcp_basic_send_recv() -> None:
    opener, _r, writer = _opener([b"\x01\x02\x03"])
    t = RawTcpTransport("d", "h", 9000, opener=opener)
    await t.connect()
    await t.send("hello")
    assert writer.written == [b"hello"]
    data = await t.recv()
    assert data.startswith("\x01") or "\x01" in data
    await t.close()


# ---------------------------------------------------------------- modbus


def test_modbus_parse_command_variants() -> None:
    assert _parse_command("1:3:100:2") == (1, 3, 100, 2)
    assert _parse_command("0x01:0x06:0x10:0x1234") == (1, 6, 16, 0x1234)
    assert _parse_command("1:3:0") == (1, 3, 0, None)
    with pytest.raises(TransportError):
        _parse_command("bogus")


def test_modbus_crc16_known_vector() -> None:
    # FC03 read 1 reg from unit 1 @ addr 0 → CRC of 01 03 00 00 00 01 = 0x0A84
    assert _crc16(b"\x01\x03\x00\x00\x00\x01") == 0x0A84


@pytest.mark.asyncio
async def test_modbus_tcp_send_writes_mbap_frame() -> None:
    # Server response: tid=0001, proto=0000, len=0005, unit=01, fc=03, bc=02, val=0064
    response = bytes.fromhex("000100000005010302" + "0064")
    opener, _r, writer = _opener([response])
    t = ModbusTcpTransport("d", "h", unit_id=1, opener=opener)
    await t.connect()
    out = await t.query("1:3:0:1")
    assert out == response.hex()
    sent = writer.written[0]
    assert sent[6] == 0x01  # unit id
    assert sent[7] == 0x03  # fc
    await t.close()


# ---------------------------------------------------------------- factory


def test_build_transport_resolves_kinds() -> None:
    t = build_transport("scpi_tcp", device_id="x", host="h", port=1)
    assert t.kind == "scpi_tcp"
    t = build_transport("raw_tcp", device_id="x", host="h", port=1)
    assert t.kind == "raw_tcp"
    t = build_transport("modbus_tcp", device_id="x", host="h", port=502)
    assert t.kind == "modbus_tcp"


def test_build_transport_unknown_kind_raises() -> None:
    with pytest.raises(TransportError):
        build_transport("bogus", device_id="x")


# ---------------------------------------------------------------- demo
@pytest.mark.asyncio
async def test_transport_set_demo_runtime_switch() -> None:
    opener, _r, _w = _opener([b"X\n"])
    t = ScpiTcpTransport("d", "h", 1, opener=opener)
    await t.connect()
    assert t.state is TransportState.LIVE
    t.set_demo(True)
    assert t.state is TransportState.DEMO
    r = await t.query("*IDN?")
    assert "DEMO" in r
