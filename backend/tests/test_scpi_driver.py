"""Tests for the async SCPI driver against a fake TCP server.

The fake server records every line received and answers a small set of
queries (lines ending with ``?``). Each test asserts that the driver
emits exactly the SCPI strings expected by the ITECH PV6000 programming
manual.
"""
from __future__ import annotations

import asyncio
from typing import List

import pytest

from scpi_driver import (
    AsyncSCPIDriver,
    SCPIConnectionError,
    SCPITimeoutError,
)


class FakeITECHServer:
    """Async TCP server that records SCPI commands and answers queries."""

    def __init__(self, responses: dict | None = None) -> None:
        self.received: List[str] = []
        self.responses = {
            "*IDN?": "ITECH,PV6000,SN12345,1.0.0",
            "MEASure:VOLTage?": "12.3450",
            "MEASure:CURRent?": "2.5000",
            "MEASure:POWer?": "30.8625",
            "STATus:QUEStionable:CONDition?": "0",
        }
        if responses:
            self.responses.update(responses)
        self._server: asyncio.AbstractServer | None = None
        self.port: int = 0
        self.connections = 0

    async def start(self) -> None:
        self._server = await asyncio.start_server(
            self._handle, "127.0.0.1", 0
        )
        self.port = self._server.sockets[0].getsockname()[1]

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

    async def _handle(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        self.connections += 1
        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                cmd = line.decode("ascii").strip()
                self.received.append(cmd)
                if cmd.endswith("?"):
                    resp = self.responses.get(cmd, "0")
                    writer.write((resp + "\n").encode("ascii"))
                    await writer.drain()
        except (ConnectionResetError, BrokenPipeError):
            pass
        finally:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass


@pytest.fixture
async def server():
    srv = FakeITECHServer()
    await srv.start()
    try:
        yield srv
    finally:
        await srv.stop()


@pytest.fixture
async def driver(server):
    drv = AsyncSCPIDriver(
        ip="127.0.0.1",
        port=server.port,
        timeout=2.0,
        connect_timeout=2.0,
        reconnect_delay=0.05,
        max_reconnect_attempts=2,
    )
    await drv.connect()
    try:
        yield drv
    finally:
        await drv.disconnect()


# ----------------------------------------------------------------------
# Connection & low-level
# ----------------------------------------------------------------------
@pytest.mark.asyncio
async def test_connect_and_disconnect(server):
    drv = AsyncSCPIDriver(ip="127.0.0.1", port=server.port)
    assert not drv.connected
    await drv.connect()
    assert drv.connected
    await drv.disconnect()
    assert not drv.connected


@pytest.mark.asyncio
async def test_connect_failure_raises():
    # Port 1 is almost certainly closed; expect a SCPIConnectionError.
    drv = AsyncSCPIDriver(
        ip="127.0.0.1",
        port=1,
        connect_timeout=0.5,
        max_reconnect_attempts=1,
        reconnect_delay=0.01,
    )
    with pytest.raises(SCPIConnectionError):
        await drv.connect()


@pytest.mark.asyncio
async def test_async_context_manager(server):
    async with AsyncSCPIDriver(ip="127.0.0.1", port=server.port) as drv:
        assert drv.connected
        idn = await drv.idn()
        assert idn.startswith("ITECH")
    assert not drv.connected


@pytest.mark.asyncio
async def test_query_timeout(server, monkeypatch):
    # Replace responses so server never answers; query should time out.
    server.responses.clear()

    # Override handler to never write any response.
    async def silent_handle(reader, writer):
        try:
            while await reader.readline():
                pass
        finally:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass

    await server.stop()
    server._server = await asyncio.start_server(silent_handle, "127.0.0.1", 0)
    server.port = server._server.sockets[0].getsockname()[1]

    drv = AsyncSCPIDriver(
        ip="127.0.0.1", port=server.port, timeout=0.2, max_reconnect_attempts=1
    )
    await drv.connect()
    with pytest.raises(SCPITimeoutError):
        await drv.query("MEASure:VOLTage?")
    await drv.disconnect()


@pytest.mark.asyncio
async def test_auto_reconnect_after_drop(server):
    drv = AsyncSCPIDriver(
        ip="127.0.0.1",
        port=server.port,
        max_reconnect_attempts=3,
        reconnect_delay=0.01,
    )
    await drv.connect()
    assert server.connections == 1
    # Force-close the underlying writer to simulate a dropped link.
    await drv.disconnect()
    assert not drv.connected
    # Next call should transparently reconnect.
    idn = await drv.idn()
    assert "ITECH" in idn
    assert server.connections == 2


# ----------------------------------------------------------------------
# Identity / output / setpoints
# ----------------------------------------------------------------------
@pytest.mark.asyncio
async def test_idn(server, driver):
    result = await driver.idn()
    assert result == "ITECH,PV6000,SN12345,1.0.0"
    assert server.received == ["*IDN?"]


@pytest.mark.asyncio
async def test_output_on_off(server, driver):
    await driver.output(True)
    await driver.output(False)
    assert server.received == ["OUTPut ON", "OUTPut OFF"]


@pytest.mark.asyncio
async def test_set_volt(server, driver):
    await driver.set_volt(48.0)
    assert server.received == ["SOURce:VOLTage 48.0000"]


@pytest.mark.asyncio
async def test_set_curr(server, driver):
    await driver.set_curr(9.5)
    assert server.received == ["SOURce:CURRent 9.5000"]


# ----------------------------------------------------------------------
# Measurement
# ----------------------------------------------------------------------
@pytest.mark.asyncio
async def test_meas_v(server, driver):
    v = await driver.meas_v()
    assert v == pytest.approx(12.345)
    assert server.received == ["MEASure:VOLTage?"]


@pytest.mark.asyncio
async def test_meas_i(server, driver):
    i = await driver.meas_i()
    assert i == pytest.approx(2.5)
    assert server.received == ["MEASure:CURRent?"]


@pytest.mark.asyncio
async def test_meas_p(server, driver):
    p = await driver.meas_p()
    assert p == pytest.approx(30.8625)
    assert server.received == ["MEASure:POWer?"]


# ----------------------------------------------------------------------
# Protections
# ----------------------------------------------------------------------
@pytest.mark.asyncio
async def test_set_ovp(server, driver):
    await driver.set_ovp(60.0, delay=0.5)
    assert server.received == [
        "SOURce:VOLTage:PROTection:LEVel 60.0000",
        "SOURce:VOLTage:PROTection:DELay 0.5000",
        "SOURce:VOLTage:PROTection:STATe ON",
    ]


@pytest.mark.asyncio
async def test_set_ocp(server, driver):
    await driver.set_ocp(10.0, delay=0.25)
    assert server.received == [
        "SOURce:CURRent:PROTection:LEVel 10.0000",
        "SOURce:CURRent:PROTection:DELay 0.2500",
        "SOURce:CURRent:PROTection:STATe ON",
    ]


@pytest.mark.asyncio
async def test_set_opp(server, driver):
    await driver.set_opp(500.0, delay=1.0)
    assert server.received == [
        "SOURce:POWer:PROTection:LEVel 500.0000",
        "SOURce:POWer:PROTection:DELay 1.0000",
        "SOURce:POWer:PROTection:STATe ON",
    ]


@pytest.mark.asyncio
async def test_set_uvp(server, driver):
    await driver.set_uvp(5.0, delay=0.2)
    assert server.received == [
        "SOURce:VOLTage:LIMit:LOW 5.0000",
        "SOURce:VOLTage:LIMit:LOW:DELay 0.2000",
        "SOURce:VOLTage:LIMit:LOW:STATe ON",
    ]


@pytest.mark.asyncio
async def test_set_ucp(server, driver):
    await driver.set_ucp(0.1, delay=0.3)
    assert server.received == [
        "SOURce:CURRent:LIMit:LOW 0.1000",
        "SOURce:CURRent:LIMit:LOW:DELay 0.3000",
        "SOURce:CURRent:LIMit:LOW:STATe ON",
    ]


@pytest.mark.asyncio
async def test_clear_protect(server, driver):
    await driver.clear_protect()
    assert server.received == ["SOURce:PROTection:CLEar"]


@pytest.mark.asyncio
async def test_prot_status(server, driver):
    server.responses["STATus:QUEStionable:CONDition?"] = "5"
    result = await driver.prot_status()
    assert result == 5
    assert server.received == ["STATus:QUEStionable:CONDition?"]


# ----------------------------------------------------------------------
# Solar Array Simulator
# ----------------------------------------------------------------------
@pytest.mark.asyncio
async def test_set_sas(server, driver):
    await driver.set_sas(voc=48.0, vmp=40.0, isc=10.0, imp=9.0)
    assert server.received == [
        "SOURce:FUNCtion SAS",
        "SOURce:SAS:VOC 48.0000",
        "SOURce:SAS:VMP 40.0000",
        "SOURce:SAS:ISC 10.0000",
        "SOURce:SAS:IMP 9.0000",
        "SOURce:SAS:CURVe:UPDate",
    ]


@pytest.mark.asyncio
async def test_set_sas_validates(driver):
    with pytest.raises(ValueError):
        await driver.set_sas(voc=10, vmp=12, isc=5, imp=4)
    with pytest.raises(ValueError):
        await driver.set_sas(voc=48, vmp=40, isc=5, imp=6)


# ----------------------------------------------------------------------
# Arbitrary waveform user table
# ----------------------------------------------------------------------
@pytest.mark.asyncio
async def test_download_arb_user(server, driver):
    pts = [(0.0, 10.0), (24.0, 9.5), (40.0, 9.0), (48.0, 0.0)]
    await driver.download_arb_user(pts)
    assert server.received == [
        "SOURce:FUNCtion SAS",
        "SOURce:SAS:CURVe:TABLe USER",
        "SOURce:SAS:CURVe:TABLe:POINts 4",
        "SOURce:SAS:CURVe:TABLe:DATA "
        "0.0000,10.0000,24.0000,9.5000,40.0000,9.0000,48.0000,0.0000",
        "SOURce:SAS:CURVe:UPDate",
    ]


@pytest.mark.asyncio
async def test_download_arb_user_empty_rejected(driver):
    with pytest.raises(ValueError):
        await driver.download_arb_user([])


# ----------------------------------------------------------------------
# LIST mode program
# ----------------------------------------------------------------------
@pytest.mark.asyncio
async def test_download_program_full(server, driver):
    steps = [
        {"voltage": 0.0, "current": 5.0, "dwell": 1.0},
        {"voltage": 24.0, "current": 4.5, "dwell": 2.0},
        {"voltage": 48.0, "current": 0.0, "dwell": 0.5},
    ]
    await driver.download_program(steps)
    assert server.received == [
        "SOURce:LIST:CLEar",
        "SOURce:LIST:COUNt 3",
        "SOURce:LIST:VOLTage 0.0000,24.0000,48.0000",
        "SOURce:LIST:CURRent 5.0000,4.5000,0.0000",
        "SOURce:LIST:DWELl 1.0000,2.0000,0.5000",
        "SOURce:FUNCtion:MODE LIST",
    ]


@pytest.mark.asyncio
async def test_download_program_only_voltage(server, driver):
    steps = [{"voltage": 1.0}, {"voltage": 2.0}]
    await driver.download_program(steps)
    assert server.received == [
        "SOURce:LIST:CLEar",
        "SOURce:LIST:COUNt 2",
        "SOURce:LIST:VOLTage 1.0000,2.0000",
        "SOURce:FUNCtion:MODE LIST",
    ]


@pytest.mark.asyncio
async def test_download_program_empty_rejected(driver):
    with pytest.raises(ValueError):
        await driver.download_program([])
