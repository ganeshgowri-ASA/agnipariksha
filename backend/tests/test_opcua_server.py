"""Round-trip test for the Agnipariksha PSU OPC UA server."""
from __future__ import annotations

import socket
import sys
from pathlib import Path

import pytest
from asyncua import Client

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.opcua_server import (  # noqa: E402
    PsuOpcUaServer,
    PsuReadings,
)


def _free_endpoint() -> str:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return f"opc.tcp://127.0.0.1:{port}/agnipariksha/server"


async def _qname_child(parent, idx: int, name: str):
    return await parent.get_child([f"{idx}:{name}"])


async def test_server_exposes_psu_tree_and_round_trips_setpoints() -> None:
    endpoint = _free_endpoint()
    async with PsuOpcUaServer(endpoint=endpoint, mode="DEMO") as server:
        await server.update_readings(
            PsuReadings(voltage_v=12.5, current_a=2.0, power_w=25.0, temperature_c=30.0)
        )

        client = Client(url=endpoint)
        await client.connect()
        try:
            idx = await client.get_namespace_index(server.namespace_uri)
            agni = await _qname_child(client.nodes.objects, idx, "Agnipariksha")
            psu = await _qname_child(agni, idx, "PSU")
            readings = await _qname_child(psu, idx, "Readings")
            setpoints = await _qname_child(psu, idx, "Setpoints")
            info = await _qname_child(psu, idx, "Info")

            v = await (await _qname_child(readings, idx, "Voltage_V")).read_value()
            t = await (await _qname_child(readings, idx, "Temperature_C")).read_value()
            assert v == 12.5
            assert t == 30.0

            v_sp = await _qname_child(setpoints, idx, "Voltage_Setpoint_V")
            out_en = await _qname_child(setpoints, idx, "Output_Enabled")
            await v_sp.write_value(48.0)
            await out_en.write_value(True)

            sp = await server.get_setpoints()
            assert sp.voltage_v == 48.0
            assert sp.output_enabled is True

            model = await (await _qname_child(info, idx, "Model")).read_value()
            mode = await (await _qname_child(info, idx, "Mode")).read_value()
            assert model == "ITECH PV6000"
            assert mode == "DEMO"
        finally:
            await client.disconnect()


async def test_readings_node_is_client_read_only() -> None:
    endpoint = _free_endpoint()
    async with PsuOpcUaServer(endpoint=endpoint) as server:
        client = Client(url=endpoint)
        await client.connect()
        try:
            idx = await client.get_namespace_index(server.namespace_uri)
            agni = await _qname_child(client.nodes.objects, idx, "Agnipariksha")
            psu = await _qname_child(agni, idx, "PSU")
            readings = await _qname_child(psu, idx, "Readings")
            v_node = await _qname_child(readings, idx, "Voltage_V")
            with pytest.raises(Exception):
                await v_node.write_value(99.9)
        finally:
            await client.disconnect()
