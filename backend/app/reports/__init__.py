"""IEC-formatted report generation (PDF + HTML twin), DEMO fixtures only."""
from .builder import render_html, render_pdf
from .fixtures import ReportRun, TestBlock, get_run, list_runs
from .router import router as reports_router

__all__ = [
    "ReportRun",
    "TestBlock",
    "get_run",
    "list_runs",
    "render_html",
    "render_pdf",
    "reports_router",
]
