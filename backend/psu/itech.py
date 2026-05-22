"""ITech PV6000 / IT6000 PSU driver - raw TCP SCPI.

Ported from the original ``backend.scpi_driver`` module. The legacy
``SCPIDriver`` symbol now re-exports :class:`ITechPV6000Driver` so any
existing imports keep working untouched.

Device default: 192.168.200.100:30000 (from device.xml).
"""
from __future__ import annotations

import socket
import time
from typing import Optional

from .base import PSUDriver
from .registry import register_driver

DEVICE_IP = "192.168.200.100"
DEVICE_PORT = 30000
BUFFER_SIZE = 4096
TIMEOUT = 5.0


class ITechPV6000Driver(PSUDriver):
    """Synchronous TCP SCPI driver for the ITech PV6000 family."""

    make = "itech"
    model = "PV6000"

    def __init__(self, ip: str = DEVICE_IP, port: int = DEVICE_PORT) -> None:
        self.ip = ip
        self.port = port
        self.host = ip
        self._sock: Optional[socket.socket] = None

    # --- Connection lifecycle ----------------------------------------
    def connect(self) -> str:
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.settimeout(TIMEOUT)
        self._sock.connect((self.ip, self.port))
        idn = self.query("*IDN?")
        print(f"[SCPI] Connected: {idn}")
        return idn

    def disconnect(self) -> None:
        if self._sock:
            self._sock.close()
            self._sock = None

    # --- Low-level transport -----------------------------------------
    def send(self, command: str) -> None:
        if not self._sock:
            raise ConnectionError("Not connected to ITECH device")
        self._sock.sendall((command + "\n").encode())
        time.sleep(0.05)

    def query(self, command: str) -> str:
        self.send(command)
        assert self._sock is not None  # send() guarantees this
        data = self._sock.recv(BUFFER_SIZE)
        return data.decode().strip()

    # --- PSUDriver contract ------------------------------------------
    def idn(self) -> str:
        return self.query("*IDN?")

    def output_on(self) -> None:
        self.send("OUTPut ON")

    def output_off(self) -> None:
        self.send("OUTPut OFF")

    def set_voltage(self, v: float) -> None:
        self.send(f"SOURce:VOLTage:LEVel:IMMediate {v:.4f}")

    def set_current(self, i: float) -> None:
        self.send(f"SOURce:CURRent:LEVel:IMMediate {i:.4f}")

    def measure_voltage(self) -> float:
        return float(self.query("MEASure:VOLTage:DC?"))

    def measure_current(self) -> float:
        return float(self.query("MEASure:CURRent:DC?"))

    def measure_power(self) -> float:
        return float(self.query("MEASure:POWer?"))

    # --- ITech extras (preserved for back-compat with test_programs/) -
    def measure_all(self) -> dict:
        return {
            "voltage": self.measure_voltage(),
            "current": self.measure_current(),
            "power": self.measure_power(),
            "timestamp": time.time(),
        }

    def set_ovp(self, v: float) -> None:
        self.send(f"SOURce:VOLTage:PROTection:LEVel {v:.4f}")

    def set_ocp(self, i: float) -> None:
        self.send(f"SOURce:CURRent:PROTection:LEVel {i:.4f}")

    # --- IEC test convenience helpers (ported verbatim from legacy) --
    def run_thermal_cycling_step(self, isc: float, cycles: int = 200) -> None:
        """IEC 61215-2 MQT 11: 200 cycles, -40 to +85C, I=Isc"""
        print(f"[TC] Starting Thermal Cycling: {cycles} cycles, Isc={isc}A")
        self.set_current(isc); self.set_voltage(0.5); self.output_on()

    def run_humidity_freeze_step(self, isc: float) -> None:
        """IEC 61215-2 MQT 12: 85%RH, +85C to -40C, I=Isc"""
        print(f"[HF] Humidity Freeze: Isc={isc}A")
        self.set_current(isc); self.set_voltage(0.5); self.output_on()

    def run_letid_sequence(self, isc: float, imp: float, duration_h: float = 162) -> None:
        """IEC TS 63342: LeTID at 75C, Idark = Isc - Imp for 162h"""
        idark = isc - imp
        print(f"[LeTID] Idark={idark:.3f}A for {duration_h}h at 75C")
        self.set_current(idark); self.set_voltage(0.5); self.output_on()

    def run_bypass_diode_test(self, isc: float, duration_s: float = 3600) -> None:
        """IEC 62979: Bypass diode thermal at 1.35*Isc for 1h"""
        i_test = 1.35 * isc
        print(f"[BDT] Bypass diode thermal: {i_test:.3f}A for {duration_s}s")
        self.set_current(i_test); self.set_voltage(0.5); self.output_on()

    def run_reverse_current_overload(self, isc: float, fuse_rating: float) -> None:
        """IEC 61730-2 MST 26: 135% of fuse rating or 1.35*Isc"""
        i_test = max(1.35 * isc, 1.35 * fuse_rating)
        print(f"[RCO] Reverse current: {i_test:.3f}A")
        self.set_current(i_test); self.set_voltage(0.5); self.output_on()

    def run_ground_continuity(self, test_current: float = 25.0, resistance_limit: float = 0.1):
        """IEC 61730-2 MST 13: 25A or 2*Isc, R < 0.1 Ohm"""
        print(f"[GCT] Ground continuity: {test_current}A, limit={resistance_limit}Ohm")
        self.set_current(test_current); self.set_voltage(6.0); self.output_on()
        time.sleep(1)
        v = self.measure_voltage(); i = self.measure_current()
        if i > 0:
            r = v / i
            result = "PASS" if r < resistance_limit else "FAIL"
            print(f"[GCT] R={r:.4f}Ohm -> {result}")
            return r, result
        return None, "ERROR"


register_driver("itech_pv6000", ITechPV6000Driver)
