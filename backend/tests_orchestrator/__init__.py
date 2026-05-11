"""IEC test orchestrators for the PV6000 station.

Each module exposes an async test class with a uniform contract:
    start(params)                -> session_id
    stop()                       -> None
    status()                     -> dict
    stream_samples()             -> async generator of samples
    validate()                   -> ComplianceResult

Drivers are pluggable via the ``DriverProtocol`` defined in ``base``;
both the real ``SCPIDriver`` (from ``..scpi_driver``) and the
``DemoDriver`` shipped here satisfy the protocol.
"""
from .base import (
    DriverProtocol,
    OrchestratorState,
    Sample,
    ComplianceResult,
    BaseOrchestrator,
)
from .demo_driver import DemoDriver
from .thermal_cycling import ThermalCyclingOrchestrator
from .humidity_freeze import HumidityFreezeOrchestrator
from .letid import LeTIDOrchestrator
from .bypass_diode import BypassDiodeOrchestrator
from .reverse_current_overload import ReverseCurrentOverloadOrchestrator
from .ground_continuity import GroundContinuityOrchestrator

__all__ = [
    "DriverProtocol",
    "OrchestratorState",
    "Sample",
    "ComplianceResult",
    "BaseOrchestrator",
    "DemoDriver",
    "ThermalCyclingOrchestrator",
    "HumidityFreezeOrchestrator",
    "LeTIDOrchestrator",
    "BypassDiodeOrchestrator",
    "ReverseCurrentOverloadOrchestrator",
    "GroundContinuityOrchestrator",
]
