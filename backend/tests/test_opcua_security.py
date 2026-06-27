"""OPC UA security tests: username/password auth + writable-node allow-list."""
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
    WRITABLE_NODES,
    CredentialUserManager,
    PsuOpcUaServer,
)


def _free_endpoint() -> str:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return f"opc.tcp://127.0.0.1:{port}/agnipariksha/server"


def test_credential_user_manager_accepts_only_valid_pairs() -> None:
    um = CredentialUserManager({"operator": "pv6000"})
    assert um.get_user(None, "operator", "pv6000") is not None
    assert um.get_user(None, "operator", "wrong") is None
    assert um.get_user(None, "ghost", "pv6000") is None
    assert um.get_user(None, None, None) is None  # anonymous


def test_writable_allow_list_is_setpoints_only() -> None:
    # The allow-list is the single source of truth for client-writability.
    assert set(WRITABLE_NODES) == {
        "Voltage_Setpoint_V",
        "Current_Setpoint_A",
        "Output_Enabled",
    }


async def test_authenticated_client_connects_and_writes_setpoint() -> None:
    endpoint = _free_endpoint()
    async with PsuOpcUaServer(endpoint=endpoint, users={"operator": "pv6000"}) as server:
        client = Client(url=endpoint)
        client.set_user("operator")
        client.set_password("pv6000")
        await client.connect()
        try:
            idx = await client.get_namespace_index(server.namespace_uri)
            agni = await client.nodes.objects.get_child([f"{idx}:Agnipariksha"])
            psu = await agni.get_child([f"{idx}:PSU"])
            setpoints = await psu.get_child([f"{idx}:Setpoints"])
            v_sp = await setpoints.get_child([f"{idx}:Voltage_Setpoint_V"])
            await v_sp.write_value(36.0)
            sp = await server.get_setpoints()
            assert sp.voltage_v == 36.0
        finally:
            await client.disconnect()


async def test_wrong_password_is_rejected() -> None:
    endpoint = _free_endpoint()
    async with PsuOpcUaServer(endpoint=endpoint, users={"operator": "pv6000"}):
        client = Client(url=endpoint)
        client.set_user("operator")
        client.set_password("nope")
        with pytest.raises(Exception):
            await client.connect()


async def test_anonymous_is_rejected_when_auth_configured() -> None:
    endpoint = _free_endpoint()
    async with PsuOpcUaServer(endpoint=endpoint, users={"operator": "pv6000"}):
        client = Client(url=endpoint)  # no credentials
        with pytest.raises(Exception):
            await client.connect()
