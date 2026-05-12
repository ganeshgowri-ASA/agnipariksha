"""Test orchestrators for IEC qualification programs.

Each module exposes a self-contained orchestrator (session, simulator,
analyser, report builder) so the FastAPI control plane can drive
multiple tests in parallel without sharing global state.
"""
