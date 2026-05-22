"""Tests for the offline IV-curve importer (CSV/XLSX, no PSU)."""
from __future__ import annotations

import io
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.main import app  # noqa: E402


HEADER = "V,I,T_module_c,irradiance_w_m2,timestamp"


def _good_csv(n: int = 11) -> str:
    """A monotonically-increasing V sweep from 0 to Voc≈10 with linear-ish I."""
    rows = [HEADER]
    for k in range(n):
        v = round(k * 1.0, 3)
        i = round(max(0.0, 8.0 - 0.8 * k), 3)
        rows.append(f"{v},{i},25.0,1000.0,2026-05-19T10:00:{k:02d}Z")
    return "\n".join(rows) + "\n"


def _post(client: TestClient, payload: str, name: str = "iv.csv",
          ctype: str = "text/csv", **form):
    files = {"file": (name, payload, ctype)}
    return client.post("/api/iv/import", files=files, data=form or None)


def test_happy_path_csv() -> None:
    with TestClient(app) as c:
        r = _post(c, _good_csv(), area_m2="1.65")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["n_points"] == 11
        # 8A at 0V, 0A at 10V, linear → Pmax around V=5, I=4, P=20W.
        assert body["Pmax_w"] == pytest.approx(20.0, abs=0.5)
        assert body["Voc_v"] == pytest.approx(10.0, abs=0.1)
        assert body["Isc_a"] == pytest.approx(8.0, abs=0.1)
        assert 0.2 < body["FF"] < 0.5  # triangular curve ~0.25
        assert body["eta"] == pytest.approx(body["Pmax_w"] / 1000.0 / 1.65, rel=1e-3)
        assert body["irradiance_w_m2"] == pytest.approx(1000.0)
        assert body["T_module_c_mean"] == pytest.approx(25.0)
        assert isinstance(body["run_id"], str) and len(body["run_id"]) >= 8


def test_missing_column_rejected() -> None:
    bad = "V,I,T_module_c,timestamp\n0,8,25,t1\n1,7,25,t2\n"
    with TestClient(app) as c:
        r = _post(c, bad)
        assert r.status_code == 400
        assert "missing columns" in r.json()["detail"]
        assert "irradiance_w_m2" in r.json()["detail"]


def test_nan_rejected() -> None:
    bad = f"{HEADER}\n0,8,25,1000,t1\n1,,25,1000,t2\n"
    with TestClient(app) as c:
        r = _post(c, bad)
        assert r.status_code == 400
        assert "NaN" in r.json()["detail"] or "non-numeric" in r.json()["detail"]


def test_non_monotonic_v_rejected() -> None:
    bad = f"{HEADER}\n0,8,25,1000,t1\n0.5,7,25,1000,t2\n0.4,6,25,1000,t3\n1.0,5,25,1000,t4\n"
    with TestClient(app) as c:
        r = _post(c, bad)
        assert r.status_code == 400
        assert "monotonic" in r.json()["detail"]


def test_decreasing_v_accepted() -> None:
    # Strictly decreasing V is also a valid sweep direction.
    rows = [HEADER]
    for k in range(10, -1, -1):
        rows.append(f"{float(k)},{max(0.0, 8.0 - 0.8 * k):.3f},25,1000,t{k}")
    with TestClient(app) as c:
        r = _post(c, "\n".join(rows) + "\n")
        assert r.status_code == 200, r.text


def test_empty_upload_rejected() -> None:
    with TestClient(app) as c:
        r = _post(c, "")
        assert r.status_code == 400


def test_single_row_rejected() -> None:
    one = f"{HEADER}\n0,8,25,1000,t1\n"
    with TestClient(app) as c:
        r = _post(c, one)
        assert r.status_code == 400


def test_unsupported_extension_rejected() -> None:
    with TestClient(app) as c:
        r = _post(c, _good_csv(), name="iv.txt", ctype="text/plain")
        assert r.status_code == 400
        assert ".csv" in r.json()["detail"] or "xlsx" in r.json()["detail"]


def test_negative_area_rejected() -> None:
    with TestClient(app) as c:
        r = _post(c, _good_csv(), area_m2="-1")
        assert r.status_code == 400


def test_xlsx_round_trip(tmp_path: Path) -> None:
    wb = Workbook()
    ws = wb.active
    ws.append(["V", "I", "T_module_c", "irradiance_w_m2", "timestamp"])
    for k in range(11):
        ws.append([float(k), max(0.0, 8.0 - 0.8 * k), 25.0, 1000.0, f"t{k}"])
    buf = io.BytesIO()
    wb.save(buf)
    payload = buf.getvalue()
    with TestClient(app) as c:
        files = {"file": (
            "iv.xlsx", payload,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )}
        r = c.post("/api/iv/import", files=files)
        assert r.status_code == 200, r.text
        assert r.json()["n_points"] == 11


def test_template_csv_download() -> None:
    with TestClient(app) as c:
        r = c.get("/api/iv/import/template/csv")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        body = r.text
        for col in ("V", "I", "T_module_c", "irradiance_w_m2", "timestamp"):
            assert col in body
        # header + at least 1 sample row
        assert len([ln for ln in body.splitlines() if ln.strip()]) >= 2


def test_template_xlsx_download() -> None:
    with TestClient(app) as c:
        r = c.get("/api/iv/import/template/xlsx")
        assert r.status_code == 200
        assert "spreadsheetml" in r.headers["content-type"]
        assert r.content[:2] == b"PK"  # xlsx is a zip container


def test_template_bad_format() -> None:
    with TestClient(app) as c:
        r = c.get("/api/iv/import/template/pdf")
        assert r.status_code == 400


def test_run_lookup_404() -> None:
    with TestClient(app) as c:
        r = c.get("/api/iv/import/does-not-exist")
        assert r.status_code == 404


def test_run_lookup_roundtrip() -> None:
    with TestClient(app) as c:
        post = _post(c, _good_csv())
        assert post.status_code == 200
        run_id = post.json()["run_id"]
        r = c.get(f"/api/iv/import/{run_id}")
        assert r.status_code == 200
        assert r.json()["run_id"] == run_id


def test_lab_header_aliases_accepted() -> None:
    # Real-world lab exports use unit-bracketed headers; the importer
    # normalises them to the canonical schema before validation.
    rows = ["Voltage [V],Current [A],Temperature [°C],Irradiance [W/m^2],Time"]
    for k in range(11):
        rows.append(f"{float(k)},{max(0.0, 8.0 - 0.8 * k):.3f},25,1000,t{k}")
    with TestClient(app) as c:
        r = _post(c, "\n".join(rows) + "\n")
        assert r.status_code == 200, r.text
        assert r.json()["n_points"] == 11
