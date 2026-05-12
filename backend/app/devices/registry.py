"""Load device manifests from YAML and resolve them to transports.

Manifest schema (per file):
    id: itech_pv6000
    name: ITECH PV6000
    role: dc_source           # dc_source | chamber | dmm | switch | ...
    vendor: ITECH
    model: PV6000
    transport:
      kind: scpi_tcp          # scpi_tcp | scpi_usbtmc | modbus_tcp | ...
      host: 192.168.200.100
      port: 30000
      timeout_s: 1.5
    demo: true                # initial mode
    standards: [IEC 61215]

The YAML parser uses ``pyyaml`` when available, otherwise falls back to
a minimal JSON-subset parser so the registry loads in stripped-down
environments.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional


_LOG = logging.getLogger("agnipariksha.devices")


def _parse_yaml(text: str) -> Any:
    try:
        import yaml  # type: ignore

        return yaml.safe_load(text)
    except ImportError:
        return _parse_yaml_minimal(text)


def _parse_yaml_minimal(text: str) -> Any:
    """Tiny YAML subset parser — handles the manifest shape we ship.

    Supports nested mappings (2-space indent) and inline list literals
    (``[a, b, c]``). Sufficient for the device files in this repo; we
    rely on the runtime to have ``pyyaml`` for anything more elaborate.
    """
    lines = [ln.rstrip() for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    root: Dict[str, Any] = {}
    stack: List[tuple[int, Dict[str, Any]]] = [(-1, root)]
    for ln in lines:
        indent = len(ln) - len(ln.lstrip(" "))
        body = ln.strip()
        while stack and indent <= stack[-1][0]:
            stack.pop()
        parent = stack[-1][1]
        if ":" not in body:
            continue
        key, _, raw = body.partition(":")
        key = key.strip()
        raw = raw.strip()
        if not raw:
            child: Dict[str, Any] = {}
            parent[key] = child
            stack.append((indent, child))
            continue
        parent[key] = _coerce(raw)
    return root


_NUM = re.compile(r"^-?\d+(\.\d+)?$")


def _coerce(raw: str) -> Any:
    if raw.startswith("[") and raw.endswith("]"):
        items = [_coerce(p.strip()) for p in raw[1:-1].split(",") if p.strip()]
        return items
    if raw.lower() in {"true", "yes"}:
        return True
    if raw.lower() in {"false", "no"}:
        return False
    if raw.lower() == "null":
        return None
    if _NUM.match(raw):
        return float(raw) if "." in raw else int(raw)
    return raw.strip("\"'")


@dataclass
class Device:
    """In-memory representation of one device manifest."""

    id: str
    name: str
    role: str
    vendor: str
    model: str
    transport_kind: str
    transport_opts: Dict[str, Any]
    demo: bool = True
    standards: List[str] = field(default_factory=list)
    description: Optional[str] = None
    health: Dict[str, Any] = field(default_factory=dict)
    _transport_obj: Optional[Any] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Device":
        t = d.get("transport") or {}
        kind = t.get("kind") or "scpi_tcp"
        opts = {k: v for k, v in t.items() if k != "kind"}
        return cls(
            id=str(d["id"]),
            name=str(d.get("name", d["id"])),
            role=str(d.get("role", "generic")),
            vendor=str(d.get("vendor", "")),
            model=str(d.get("model", "")),
            transport_kind=kind,
            transport_opts=opts,
            demo=bool(d.get("demo", True)),
            standards=list(d.get("standards", []) or []),
            description=d.get("description"),
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "vendor": self.vendor,
            "model": self.model,
            "transport": {"kind": self.transport_kind, **self.transport_opts},
            "demo": self.demo,
            "standards": self.standards,
            "description": self.description,
            "health": self.health,
        }

    def get_transport(self) -> Any:
        """Build (and cache) the concrete transport for this device."""
        if self._transport_obj is None:
            from backend.app.transports import build_transport

            self._transport_obj = build_transport(
                self.transport_kind,
                device_id=self.id,
                demo=self.demo,
                **self.transport_opts,
            )
        else:
            self._transport_obj.set_demo(self.demo)
        return self._transport_obj


class DeviceRegistry:
    """A handful of devices keyed by id, with a YAML loader."""

    def __init__(self, devices: Optional[List[Device]] = None) -> None:
        self._devices: Dict[str, Device] = {d.id: d for d in (devices or [])}

    def add(self, device: Device) -> None:
        self._devices[device.id] = device

    def get(self, device_id: str) -> Optional[Device]:
        return self._devices.get(device_id)

    def all(self) -> List[Device]:
        return list(self._devices.values())

    def __iter__(self) -> Iterator[Device]:
        return iter(self._devices.values())

    def __len__(self) -> int:
        return len(self._devices)

    def to_list(self) -> List[Dict[str, Any]]:
        return [d.to_dict() for d in self._devices.values()]


def load_devices(directory: Path) -> DeviceRegistry:
    reg = DeviceRegistry()
    if not directory.exists():
        _LOG.warning("device directory %s missing", directory)
        return reg
    for path in sorted(directory.glob("*.yaml")):
        try:
            text = path.read_text(encoding="utf-8")
            data = _parse_yaml(text)
            if not isinstance(data, dict) or "id" not in data:
                _LOG.warning("skipping %s: missing id", path)
                continue
            reg.add(Device.from_dict(data))
        except Exception as exc:  # noqa: BLE001
            _LOG.error("failed to load device manifest %s: %s", path, exc)
    return reg


_REGISTRY: Optional[DeviceRegistry] = None


def get_registry() -> DeviceRegistry:
    """Process-wide singleton. Loads from ``backend/app/devices`` on first use."""
    global _REGISTRY
    if _REGISTRY is None:
        _REGISTRY = load_devices(Path(__file__).parent)
    return _REGISTRY


def _reset_registry_for_tests() -> None:
    """Drop the cached registry — used only by the test-suite."""
    global _REGISTRY
    _REGISTRY = None
