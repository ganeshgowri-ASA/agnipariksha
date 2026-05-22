"""Orchestrators for IEC safety/degradation test sequences.

Each orchestrator owns the state machine for one IEC test (e.g. GCT,
PID) and exposes a uniform ``to_dict()`` payload for routes/UI.
DEMO_MODE is enforced inside each orchestrator (``assert DEMO_MODE``);
live energization paths are guarded by ``# TODO(PR#52a/b)`` markers
until the safety gate (basic-check / interlock / OVP-OCP) lands.
"""
