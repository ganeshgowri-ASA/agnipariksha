"""Synthetic-run tests for the IEC test orchestrators.

These tests use ``DemoDriver`` and tiny dwell parameters so each test
finishes in well under a second while still exercising the full state
machine, sample streaming, and compliance validators.
"""
from __future__ import annotations

import asyncio
import os
import sys
import unittest

# Make ``backend`` importable when running this file directly via
# ``python -m unittest backend.tests.test_orchestrators``.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from tests_orchestrator import (  # noqa: E402
    BypassDiodeOrchestrator,
    DemoDriver,
    GroundContinuityOrchestrator,
    HumidityFreezeOrchestrator,
    LeTIDOrchestrator,
    OrchestratorState,
    ReverseCurrentOverloadOrchestrator,
    ThermalCyclingOrchestrator,
)
from tests_orchestrator.base import DriverProtocol  # noqa: E402


async def _drain(orch, *, limit: int = 10_000) -> list:
    samples = []
    async for s in orch.stream_samples():
        samples.append(s)
        if len(samples) >= limit:
            break
    return samples


async def _await_done(orch):
    if orch._task is not None:
        await orch._task


class DemoDriverProtocolTest(unittest.TestCase):
    def test_demo_driver_satisfies_protocol(self):
        self.assertIsInstance(DemoDriver(), DriverProtocol)


class ThermalCyclingTest(unittest.IsolatedAsyncioTestCase):
    async def test_synthetic_run_passes(self):
        orch = ThermalCyclingOrchestrator(DemoDriver(noise=0.001),
                                          sample_interval_s=0.01)
        await orch.start({
            "voc": 45.0, "isc": 9.5, "cycles": 3,
            "hot_dwell_s": 0.05, "cold_dwell_s": 0.05, "ramp_s": 0.02,
        })
        samples = await _drain(orch)
        await _await_done(orch)

        self.assertEqual(orch.state, OrchestratorState.COMPLETED)
        self.assertEqual(orch.cycles_completed, 3)
        self.assertGreater(len(samples), 0)
        self.assertTrue(orch.compliance.passed,
                        msg=f"compliance failed: {orch.compliance.reason}")
        self.assertEqual(orch.compliance.standard, "IEC 61215-2 MQT 11")

    async def test_short_run_fails_compliance_on_cycle_count(self):
        orch = ThermalCyclingOrchestrator(DemoDriver(),
                                          sample_interval_s=0.01)
        await orch.start({
            "voc": 45.0, "isc": 9.5, "cycles": 5,
            "hot_dwell_s": 0.05, "cold_dwell_s": 0.05, "ramp_s": 0.02,
        })
        await asyncio.sleep(0.05)
        await orch.stop()
        async for _ in orch.stream_samples():
            pass
        self.assertLess(orch.cycles_completed, 5)
        self.assertFalse(orch.compliance.passed)
        self.assertIn("cycles", orch.compliance.reason.lower())

    async def test_status_shape(self):
        orch = ThermalCyclingOrchestrator(DemoDriver(), sample_interval_s=0.01)
        await orch.start({"cycles": 1, "hot_dwell_s": 0.02,
                          "cold_dwell_s": 0.02, "ramp_s": 0.01})
        st = orch.status()
        for key in ("state", "step", "progress", "elapsed",
                    "remaining", "last_sample"):
            self.assertIn(key, st)
        await _drain(orch)
        await _await_done(orch)


class HumidityFreezeTest(unittest.IsolatedAsyncioTestCase):
    async def test_synthetic_10_cycles_pass(self):
        orch = HumidityFreezeOrchestrator(DemoDriver(noise=0.001),
                                          sample_interval_s=0.01)
        await orch.start({
            "voc": 45.0, "isc": 9.5, "cycles": 10,
            "hot_dwell_s": 0.02, "cold_dwell_s": 0.02, "transition_s": 0.01,
        })
        await _drain(orch)
        await _await_done(orch)
        self.assertEqual(orch.cycles_completed, 10)
        self.assertTrue(orch.compliance.passed, orch.compliance.reason)
        self.assertEqual(orch.compliance.standard, "IEC 61215-2 MQT 12")


class LeTIDTest(unittest.IsolatedAsyncioTestCase):
    async def test_idark_formula(self):
        self.assertAlmostEqual(LeTIDOrchestrator.calculate_idark(9.5, 8.9), 0.6)

    async def test_synthetic_run_passes(self):
        orch = LeTIDOrchestrator(DemoDriver(noise=0.0005),
                                 sample_interval_s=0.005)
        await orch.start({
            "voc": 45.0, "vmpp": 37.5, "isc": 9.5, "imp": 8.9,
            "duration_h": 0.0001,  # ~0.36 s
            "meas_interval_s": 0.01,
        })
        await _drain(orch)
        await _await_done(orch)
        self.assertEqual(orch.state, OrchestratorState.COMPLETED)
        self.assertTrue(orch.compliance.passed, orch.compliance.reason)
        self.assertEqual(orch.compliance.standard, "IEC TS 63342")

    async def test_invalid_imp_raises(self):
        orch = LeTIDOrchestrator(DemoDriver(), sample_interval_s=0.005)
        await orch.start({"isc": 8.0, "imp": 8.0, "duration_h": 0.0001,
                          "meas_interval_s": 0.005})
        await _drain(orch)
        await _await_done(orch)
        self.assertEqual(orch.state, OrchestratorState.FAILED)


class BypassDiodeTest(unittest.IsolatedAsyncioTestCase):
    async def test_pass_under_runaway_limit(self):
        drv = DemoDriver(noise=0.001)
        # 3 diodes * 1.5 V compliance = 4.5 V; runaway limit 0.7 * 3 = 2.1 V
        # → set the setpoint below that so it passes.
        orch = BypassDiodeOrchestrator(drv, sample_interval_s=0.01)
        await orch.start({
            "isc": 9.5, "num_diodes": 3,
            "duration_s": 0.1,
            "vf_limit_per_diode": 2.0,  # 6 V combined > 4.5 V compliance
        })
        await _drain(orch)
        await _await_done(orch)
        self.assertTrue(orch.compliance.passed, orch.compliance.reason)
        self.assertFalse(orch.runaway_detected)
        self.assertEqual(orch.compliance.standard, "IEC 62979")

    async def test_runaway_fails_compliance(self):
        orch = BypassDiodeOrchestrator(DemoDriver(noise=0.001),
                                       sample_interval_s=0.01)
        await orch.start({
            "isc": 9.5, "num_diodes": 3,
            "duration_s": 0.1,
            "vf_limit_per_diode": 0.5,  # 1.5 V combined < 4.5 V setpoint
        })
        await _drain(orch)
        await _await_done(orch)
        self.assertTrue(orch.runaway_detected)
        self.assertFalse(orch.compliance.passed)


class ReverseCurrentTest(unittest.IsolatedAsyncioTestCase):
    async def test_survives_full_duration(self):
        orch = ReverseCurrentOverloadOrchestrator(DemoDriver(noise=0.001),
                                                  sample_interval_s=0.01)
        await orch.start({
            "fuse_rating_a": 15.0,
            "duration_s": 0.1,
            "reverse_voltage": 40.0,
        })
        await _drain(orch)
        await _await_done(orch)
        self.assertFalse(orch.fuse_blew)
        self.assertTrue(orch.compliance.passed, orch.compliance.reason)
        self.assertEqual(orch.compliance.standard, "IEC 61730-2 MST 26")

    async def test_fuse_open_fails(self):
        drv = DemoDriver(noise=0.001)
        drv.simulate_fuse_open_after_s = 0.03
        orch = ReverseCurrentOverloadOrchestrator(drv, sample_interval_s=0.01)
        await orch.start({
            "fuse_rating_a": 15.0,
            "duration_s": 0.5,
            "reverse_voltage": 40.0,
        })
        await _drain(orch)
        await _await_done(orch)
        self.assertTrue(orch.fuse_blew)
        self.assertFalse(orch.compliance.passed)


class GroundContinuityTest(unittest.IsolatedAsyncioTestCase):
    async def test_low_resistance_passes(self):
        drv = DemoDriver(noise=0.0005)
        drv.simulate_resistance_ohm = 0.02  # 0.02 ohm — well under 0.1
        orch = GroundContinuityOrchestrator(drv, sample_interval_s=0.005)
        # Shrink the test so it runs fast.
        orch.STABILISE_S = 0.02
        orch.MEASURE_WINDOW_S = 0.05
        await orch.start({"rated_current_a": 10.0, "multiplier": 2.5,
                          "voltage_limit_v": 6.0})
        await _drain(orch)
        await _await_done(orch)
        self.assertLess(orch.resistance_ohm, 0.1)
        self.assertTrue(orch.compliance.passed, orch.compliance.reason)
        self.assertEqual(orch.compliance.standard, "IEC 61730-2 MST 13")

    async def test_high_resistance_fails(self):
        drv = DemoDriver(noise=0.0005)
        drv.simulate_resistance_ohm = 0.25
        orch = GroundContinuityOrchestrator(drv, sample_interval_s=0.005)
        orch.STABILISE_S = 0.02
        orch.MEASURE_WINDOW_S = 0.05
        await orch.start({"rated_current_a": 10.0, "multiplier": 2.5,
                          "voltage_limit_v": 6.0})
        await _drain(orch)
        await _await_done(orch)
        self.assertFalse(orch.compliance.passed)
        self.assertIn("ohm", orch.compliance.reason.lower())

    async def test_under_current_fails(self):
        drv = DemoDriver(noise=0.0005)
        drv.simulate_resistance_ohm = 0.02
        orch = GroundContinuityOrchestrator(drv, sample_interval_s=0.005)
        orch.STABILISE_S = 0.02
        orch.MEASURE_WINDOW_S = 0.05
        # 2.0x multiplier < 2.5x required by MST 13 → must fail.
        await orch.start({"rated_current_a": 10.0, "multiplier": 2.0,
                          "voltage_limit_v": 6.0})
        await _drain(orch)
        await _await_done(orch)
        self.assertFalse(orch.compliance.passed)
        self.assertIn("below required", orch.compliance.reason)


class SampleStreamingTest(unittest.IsolatedAsyncioTestCase):
    async def test_stream_terminates_when_test_ends(self):
        orch = ThermalCyclingOrchestrator(DemoDriver(), sample_interval_s=0.01)
        await orch.start({"cycles": 1, "hot_dwell_s": 0.02,
                          "cold_dwell_s": 0.02, "ramp_s": 0.01})
        count = 0
        async for _ in orch.stream_samples():
            count += 1
        await _await_done(orch)
        self.assertGreater(count, 0)
        self.assertEqual(orch.state, OrchestratorState.COMPLETED)


if __name__ == "__main__":
    unittest.main()
