"""OPC UA server exposing Agnipariksha DC power-supply state + setpoints.

Address space:
  Objects/Agnipariksha/PSU/
    Readings/   (clients: read-only)   Voltage_V, Current_A, Power_W, Temperature_C
    Setpoints/  (clients: read-write)  Voltage_Setpoint_V, Current_Setpoint_A,
                                       Output_Enabled
    Info/       (clients: read-only)   Model, Mode

The server is backend-agnostic: a DEMO simulator or a LIVE ITECH PV6000
driver pushes readings via ``update_readings`` and polls operator commands
via ``get_setpoints``.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional

from asyncua import Server, ua
from asyncua.common.node import Node

DEFAULT_ENDPOINT = "opc.tcp://0.0.0.0:4840/agnipariksha/server"
NAMESPACE_URI = "urn:agnipariksha:psu"


@dataclass
class PsuReadings:
    voltage_v: float = 0.0
    current_a: float = 0.0
    power_w: float = 0.0
    temperature_c: float = 25.0


@dataclass
class PsuSetpoints:
    voltage_v: float = 0.0
    current_a: float = 0.0
    output_enabled: bool = False


class PsuOpcUaServer:
    """asyncua.Server wrapper with the Agnipariksha PSU address space."""

    def __init__(
        self,
        endpoint: str = DEFAULT_ENDPOINT,
        namespace_uri: str = NAMESPACE_URI,
        *,
        model: str = "ITECH PV6000",
        mode: str = "DEMO",
    ) -> None:
        self.endpoint = endpoint
        self.namespace_uri = namespace_uri
        self.model = model
        self.mode = mode
        self._server: Optional[Server] = None
        self._nodes: Dict[str, Node] = {}
        self._idx: int = -1

    async def init(self) -> None:
        s = Server()
        await s.init()
        s.set_endpoint(self.endpoint)
        s.set_server_name("Agnipariksha PSU OPC UA Server")
        self._idx = await s.register_namespace(self.namespace_uri)

        root = await s.nodes.objects.add_folder(self._idx, "Agnipariksha")
        psu = await root.add_folder(self._idx, "PSU")
        readings = await psu.add_folder(self._idx, "Readings")
        setpoints = await psu.add_folder(self._idx, "Setpoints")
        info = await psu.add_folder(self._idx, "Info")

        async def add_var(parent: Node, name: str, default, vtype, writable: bool = False) -> Node:
            n = await parent.add_variable(self._idx, name, default, vtype)
            if writable:
                await n.set_writable()
            self._nodes[name] = n
            return n

        d = ua.VariantType.Double
        b = ua.VariantType.Boolean
        st = ua.VariantType.String

        await add_var(readings, "Voltage_V", 0.0, d)
        await add_var(readings, "Current_A", 0.0, d)
        await add_var(readings, "Power_W", 0.0, d)
        await add_var(readings, "Temperature_C", 25.0, d)

        await add_var(setpoints, "Voltage_Setpoint_V", 0.0, d, writable=True)
        await add_var(setpoints, "Current_Setpoint_A", 0.0, d, writable=True)
        await add_var(setpoints, "Output_Enabled", False, b, writable=True)

        await add_var(info, "Model", self.model, st)
        await add_var(info, "Mode", self.mode, st)

        self._server = s

    async def start(self) -> None:
        if self._server is None:
            await self.init()
        assert self._server is not None
        await self._server.start()

    async def stop(self) -> None:
        if self._server is not None:
            await self._server.stop()

    async def __aenter__(self) -> "PsuOpcUaServer":
        await self.start()
        return self

    async def __aexit__(self, *_exc) -> None:
        await self.stop()

    async def update_readings(self, r: PsuReadings) -> None:
        """Push a fresh set of readings to the read-only nodes."""
        await self._nodes["Voltage_V"].write_value(r.voltage_v)
        await self._nodes["Current_A"].write_value(r.current_a)
        await self._nodes["Power_W"].write_value(r.power_w)
        await self._nodes["Temperature_C"].write_value(r.temperature_c)

    async def get_setpoints(self) -> PsuSetpoints:
        """Read the latest setpoints set by an OPC UA client (or LIVE op)."""
        return PsuSetpoints(
            voltage_v=await self._nodes["Voltage_Setpoint_V"].read_value(),
            current_a=await self._nodes["Current_Setpoint_A"].read_value(),
            output_enabled=await self._nodes["Output_Enabled"].read_value(),
        )
