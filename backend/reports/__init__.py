"""Report Engine v2 — user-selectable section registry + PDF/DOCX builders."""
from .registry import (
    ALL_SECTIONS,
    ALL_GRAPHS,
    ALL_TABLES,
    SECTION_LABELS,
    GRAPH_LABELS,
    TABLE_LABELS,
    ReportRequest,
    Reading,
    normalize_sections,
)
from .builders import build_pdf, build_docx

__all__ = [
    "ALL_SECTIONS",
    "ALL_GRAPHS",
    "ALL_TABLES",
    "SECTION_LABELS",
    "GRAPH_LABELS",
    "TABLE_LABELS",
    "ReportRequest",
    "Reading",
    "normalize_sections",
    "build_pdf",
    "build_docx",
]
