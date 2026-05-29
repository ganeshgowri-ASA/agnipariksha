"""IEC report generation (Tab-5).

Reports are produced server-side with ReportLab so the resulting PDF is
reproducible byte-for-byte from the same session payload + raw CSV.
That's the auditing requirement for PV qualification reports (Reliance
and other PV customers expect signed, archivable artifacts).

Public surface:

- :func:`build_iec_report` — entry point. Takes a session payload (the
  same dict the frontend POSTs to ``/api/reports/generate``) plus an
  optional raw CSV path and returns the PDF as bytes.

The matching FastAPI route lives in ``backend/api/reports_routes.py``.
"""
from .builders.iec_report import build_iec_report

__all__ = ["build_iec_report"]
