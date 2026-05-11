"""Thin stub for the tests orchestrator.

TODO: replaced by the real implementation produced by the
`feat/tests-orchestrator` branch. This stub only exists so the API can
be wired up and tested in isolation. It tracks an in-memory state per
test_id and uses the demo generators for live readings.

When DEMO_MODE is False and the real orchestrator is dropped in, the
public surface defined here (start/stop/get_state/is_running) must be
preserved.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from threading import Lock
from typing import Dict, Optional


# Map of test_id -> IEC standard reference. Mirrors CLAUDE.md.
STANDARDS = {
    "tc": "IEC 61215-2 MQT 11",
    "hf": "IEC 61215-2 MQT 12",
    "letid": "IEC TS 63342",
    "bdt": "IEC 62979",
    "rco": "IEC 61730-2 MST 26",
    "gct": "IEC 61730-2 MST 13",
}


@dataclass
class TestState:
    test_id: str
    session_id: Optional[str] = None
    started_at: Optional[float] = None
    params: dict = field(default_factory=dict)
    running: bool = False


class OrchestratorStub:
    def __init__(self) -> None:
        self._lock = Lock()
        self._states: Dict[str, TestState] = {}

    def start(self, test_id: str, session_id: str, params: dict | None = None) -> TestState:
        with self._lock:
            st = TestState(
                test_id=test_id,
                session_id=session_id,
                started_at=time.time(),
                params=params or {},
                running=True,
            )
            self._states[test_id] = st
            return st

    def stop(self, test_id: str) -> Optional[TestState]:
        with self._lock:
            st = self._states.get(test_id)
            if st:
                st.running = False
            return st

    def get_state(self, test_id: str) -> Optional[TestState]:
        return self._states.get(test_id)

    def is_running(self, test_id: str) -> bool:
        st = self._states.get(test_id)
        return bool(st and st.running)

    def running_tests(self) -> Dict[str, TestState]:
        return {k: v for k, v in self._states.items() if v.running}

    def stop_all(self) -> None:
        with self._lock:
            for st in self._states.values():
                st.running = False


orchestrator = OrchestratorStub()
