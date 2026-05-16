"""Standalone CLI probe for the ITECH PV6000 SCPI port.

Run this directly on the lab host to diagnose ``scpi_reachable: false``
without starting the FastAPI app. On multi-homed Windows boxes (Wi-Fi +
Ethernet on different subnets) it surfaces the source IP the OS picked
for the connect call — typically the smoking gun when traffic destined
for ``192.168.200.0/24`` is leaving via Wi-Fi instead of Ethernet.

Usage
-----
    python -m backend.tools.scpi_probe                       # uses .env / config defaults
    python -m backend.tools.scpi_probe --host 192.168.200.100 --port 30000
    python -m backend.tools.scpi_probe --query "*IDN?"       # also issues a SCPI query

Exit codes
----------
    0 — TCP probe succeeded (and SCPI query succeeded if --query given)
    1 — TCP probe failed
    2 — TCP probe succeeded but SCPI query failed
"""
from __future__ import annotations

import argparse
import socket
import sys
import time
from typing import Optional


def _probe(host: str, port: int, timeout_ms: int) -> dict:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout_ms / 1000.0)
    src_addr: Optional[str] = None
    os_err: Optional[str] = None
    ok = False
    t0 = time.monotonic()
    try:
        sock.connect((host, port))
        src = sock.getsockname()
        src_addr = f"{src[0]}:{src[1]}"
        ok = True
    except (OSError, socket.timeout) as exc:
        os_err = f"{type(exc).__name__}: {exc}"
    finally:
        try:
            sock.close()
        except OSError:
            pass
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    return {"ok": ok, "source": src_addr, "error": os_err, "elapsed_ms": elapsed_ms}


def _scpi_query(host: str, port: int, query: str, timeout_ms: int) -> dict:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout_ms / 1000.0)
    t0 = time.monotonic()
    response = ""
    err: Optional[str] = None
    try:
        sock.connect((host, port))
        sock.sendall((query + "\n").encode())
        buf = bytearray()
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf.extend(chunk)
            if b"\n" in chunk:
                break
        response = buf.decode(errors="replace").strip()
    except (OSError, socket.timeout) as exc:
        err = f"{type(exc).__name__}: {exc}"
    finally:
        try:
            sock.close()
        except OSError:
            pass
    return {
        "response": response,
        "error": err,
        "elapsed_ms": int((time.monotonic() - t0) * 1000),
    }


def _interface_hint(host: str, source: Optional[str]) -> Optional[str]:
    if not source:
        return None
    src_ip = source.split(":", 1)[0]
    h = host.split(".")
    s = src_ip.split(".")
    if len(h) == 4 and len(s) == 4 and h[:3] == s[:3]:
        return f"OK: source on same /24 as target ({'.'.join(h[:3])}.0/24)"
    return (
        f"WARNING: source {src_ip} is on a different subnet from target {host} — "
        "the OS routed this through the wrong interface. On Windows, check "
        "`Get-NetIPInterface` / `route print` and lower the metric of the "
        "lab Ethernet adapter so it wins over Wi-Fi."
    )


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Probe the ITECH PV6000 SCPI port")
    parser.add_argument("--host", default=None, help="ITECH IP (default: settings.ITECH_IP)")
    parser.add_argument("--port", type=int, default=None, help="ITECH SCPI port (default: 30000)")
    parser.add_argument("--timeout-ms", type=int, default=None, help="probe + query timeout (ms)")
    parser.add_argument("--query", default=None, help="SCPI query to run after connect, e.g. '*IDN?'")
    args = parser.parse_args(argv)

    host = args.host
    port = args.port
    timeout_ms = args.timeout_ms
    if host is None or port is None or timeout_ms is None:
        try:
            try:
                from backend.config import get_settings  # type: ignore[import-not-found]
            except ImportError:
                from config import get_settings  # type: ignore[no-redef]
            s = get_settings()
            host = host or s.ITECH_IP
            port = port or s.ITECH_PORT
            timeout_ms = timeout_ms if timeout_ms is not None else s.ITECH_TIMEOUT_MS
        except Exception as exc:
            print(f"could not load settings ({exc!r}); pass --host/--port explicitly", file=sys.stderr)
            return 1
    timeout_ms = timeout_ms or 1500

    print(f"probing tcp://{host}:{port} (timeout {timeout_ms} ms)…")
    probe = _probe(host, port, timeout_ms)
    if probe["ok"]:
        print(f"  OK   connect succeeded in {probe['elapsed_ms']} ms, source={probe['source']}")
    else:
        print(f"  FAIL connect failed in {probe['elapsed_ms']} ms — {probe['error']}")
    hint = _interface_hint(host, probe["source"])
    if hint:
        print(f"  hint {hint}")
    if not probe["ok"]:
        return 1

    if args.query:
        print(f"querying {args.query!r}…")
        q = _scpi_query(host, port, args.query, timeout_ms)
        if q["error"]:
            print(f"  FAIL query failed in {q['elapsed_ms']} ms — {q['error']}")
            return 2
        print(f"  OK   response in {q['elapsed_ms']} ms: {q['response']!r}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
