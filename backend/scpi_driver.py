"""ITECH PV6000 SCPI driver over raw TCP socket.
Device: 192.168.200.100:30000 (from device.xml)
"""
import socket
import time
import asyncio
from typing import Optional

DEVICE_IP = "192.168.200.100"
DEVICE_PORT = 30000
BUFFER_SIZE = 4096
TIMEOUT = 5.0


class SCPIDriver:
    def __init__(self, ip: str = DEVICE_IP, port: int = DEVICE_PORT):
        self.ip = ip
        self.port = port
        self._sock: Optional[socket.socket] = None

    def connect(self):
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.settimeout(TIMEOUT)
        self._sock.connect((self.ip, self.port))
        idn = self.query("*IDN?")
        print(f"[SCPI] Connected: {idn}")
        return idn

    def disconnect(self):
        if self._sock:
            self._sock.close()
            self._sock = None

    def send(self, command: str):
        if not self._sock:
            raise ConnectionError("Not connected to ITECH device")
        self._sock.sendall((command + "\n").encode())
        time.sleep(0.05)

    def query(self, command: str) -> str:
        self.send(command)
        data = self._sock.recv(BUFFER_SIZE)
        return data.decode().strip()

    # --- Output control ---
    def output_on(self):  self.send("OUTPut ON")
    def output_off(self): self.send("OUTPut OFF")

    # --- Voltage / Current setpoint ---
    def set_voltage(self, v: float): self.send(f"SOURce:VOLTage:LEVel:IMMediate {v:.4f}")
    def set_current(self, i: float): self.send(f"SOURce:CURRent:LEVel:IMMediate {i:.4f}")

    # --- Measurements ---
    def measure_voltage(self) -> float:
        return float(self.query("MEASure:VOLTage:DC?"))

    def measure_current(self) -> float:
        return float(self.query("MEASure:CURRent:DC?"))

    def measure_power(self) -> float:
        return float(self.query("MEASure:POWer?"))

    def measure_all(self) -> dict:
        return {
            "voltage": self.measure_voltage(),
            "current": self.measure_current(),
            "power": self.measure_power(),
            "timestamp": time.time(),
        }

    # --- Protection limits ---
    def set_ovp(self, v: float): self.send(f"SOURce:VOLTage:PROTection:LEVel {v:.4f}")
    def set_ocp(self, i: float): self.send(f"SOURce:CURRent:PROTection:LEVel {i:.4f}")

    # =========================================================
    # TEST SEQUENCES
    # =========================================================

    def run_thermal_cycling_step(self, isc: float, cycles: int = 200):
        """IEC 61215-2 MQT 11: 200 cycles, -40 to +85°C, I=Isc"""
        print(f"[TC] Starting Thermal Cycling: {cycles} cycles, Isc={isc}A")
        self.set_current(isc)
        self.set_voltage(0.5)  # Low voltage for current source mode
        self.output_on()

    def run_humidity_freeze_step(self, isc: float):
        """IEC 61215-2 MQT 12: 85%RH, +85°C to -40°C, I=Isc"""
        print(f"[HF] Humidity Freeze: Isc={isc}A")
        self.set_current(isc)
        self.set_voltage(0.5)
        self.output_on()

    def run_letid_sequence(self, isc: float, imp: float, duration_h: float = 162):
        """IEC TS 63342: LeTID at 75°C, Idark = Isc - Imp for 162h"""
        idark = isc - imp
        print(f"[LeTID] Idark={idark:.3f}A for {duration_h}h at 75°C")
        self.set_current(idark)
        self.set_voltage(0.5)
        self.output_on()

    def run_bypass_diode_test(self, isc: float, duration_s: float = 3600):
        """IEC 62979: Bypass diode thermal at 1.35*Isc for 1h"""
        i_test = 1.35 * isc
        print(f"[BDT] Bypass diode thermal: {i_test:.3f}A for {duration_s}s")
        self.set_current(i_test)
        self.set_voltage(0.5)
        self.output_on()

    def run_reverse_current_overload(self, isc: float, fuse_rating: float):
        """IEC 61730-2 MST 26: 135% of fuse rating or 1.35*Isc"""
        i_test = max(1.35 * isc, 1.35 * fuse_rating)
        print(f"[RCO] Reverse current: {i_test:.3f}A")
        self.set_current(i_test)
        self.set_voltage(0.5)
        self.output_on()

    def run_ground_continuity(self, test_current: float = 25.0, resistance_limit: float = 0.1):
        """IEC 61730-2 MST 13: 25A or 2*Isc, R < 0.1 Ohm"""
        print(f"[GCT] Ground continuity: {test_current}A, limit={resistance_limit}Ω")
        self.set_current(test_current)
        self.set_voltage(6.0)  # Low voltage high current
        self.output_on()
        time.sleep(1)
        v = self.measure_voltage()
        i = self.measure_current()
        if i > 0:
            r = v / i
            result = "PASS" if r < resistance_limit else "FAIL"
            print(f"[GCT] R={r:.4f}Ω → {result}")
            return r, result
        return None, "ERROR"
