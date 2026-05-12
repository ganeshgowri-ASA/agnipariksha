"""Printable QR labels (PDF) for modules, equipment, and spare parts.

The endpoints emit a small 3.5"×1.5" PDF containing a QR code plus
human-readable metadata, suitable for a Brother / Zebra label printer.

The QR payload is the canonical ID itself (e.g. ``MOD-001234``). Scanning
it on the /scan page deep-links to the correct detail view.
"""
from __future__ import annotations

import io
from typing import Literal

from fastapi import APIRouter, Depends, Response
from fastapi.responses import StreamingResponse

try:
    from .auth import require_user
except ImportError:  # pragma: no cover - script-mode (uvicorn main:app from backend/)
    from auth import require_user  # type: ignore[no-redef]

LabelKind = Literal["module", "equipment", "sparepart"]

router = APIRouter(tags=["labels"])


def _qr_payload(kind: LabelKind, ident: str) -> str:
    return f"{ {'module': 'MOD', 'equipment': 'EQP', 'sparepart': 'SPR'}[kind] }-{ident}".replace(" ", "")


def _render_label_pdf(kind: LabelKind, ident: str, title: str | None = None) -> bytes:
    """Render a small PDF label with QR code + caption.

    Implementation prefers ``reportlab`` + ``qrcode``; falls back to a
    plain-text PDF stub if either dependency is missing so the route
    never 500s in a minimal environment.
    """
    payload = _qr_payload(kind, ident)
    caption = title or f"{kind.title()} {ident}"

    try:
        from reportlab.lib.pagesizes import inch  # type: ignore
        from reportlab.pdfgen import canvas  # type: ignore
        from reportlab.graphics.barcode import qr  # type: ignore
        from reportlab.graphics.shapes import Drawing  # type: ignore
        from reportlab.graphics import renderPDF  # type: ignore
    except ImportError:
        return _render_stub_pdf(payload, caption)

    buf = io.BytesIO()
    page_w, page_h = 3.5 * inch, 1.5 * inch
    c = canvas.Canvas(buf, pagesize=(page_w, page_h))

    # QR on the left ~1.3"×1.3"
    qr_size = 1.2 * inch
    qr_widget = qr.QrCodeWidget(payload)
    bounds = qr_widget.getBounds()
    qw = bounds[2] - bounds[0]
    qh = bounds[3] - bounds[1]
    d = Drawing(qr_size, qr_size, transform=[qr_size / qw, 0, 0, qr_size / qh, 0, 0])
    d.add(qr_widget)
    renderPDF.draw(d, c, 0.1 * inch, 0.15 * inch)

    # Caption block on the right
    text_x = 1.5 * inch
    c.setFont("Helvetica-Bold", 11)
    c.drawString(text_x, page_h - 0.35 * inch, caption[:32])
    c.setFont("Helvetica", 9)
    c.drawString(text_x, page_h - 0.55 * inch, f"ID: {payload}")
    c.setFont("Helvetica-Oblique", 7)
    c.drawString(text_x, 0.20 * inch, "Agnipariksha · Shreshtata Power Supplies")

    c.showPage()
    c.save()
    return buf.getvalue()


def _render_stub_pdf(payload: str, caption: str) -> bytes:
    """Tiny hand-rolled PDF used when reportlab is unavailable.

    The output is a valid single-page PDF with the payload text — enough
    for unit tests and graceful degradation.
    """
    body = f"BT /F1 12 Tf 72 720 Td ({caption}) Tj 0 -20 Td ({payload}) Tj ET"
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        f"<< /Length {len(body)} >>\nstream\n{body}\nendstream".encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets: list[int] = []
    for i, obj in enumerate(objs, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref_pos = out.tell()
    out.write(f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(
        f"trailer << /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF".encode()
    )
    return out.getvalue()


def _label_response(kind: LabelKind, ident: str) -> Response:
    pdf = _render_label_pdf(kind, ident)
    headers = {"Content-Disposition": f'inline; filename="{kind}-{ident}.pdf"'}
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf", headers=headers)


@router.get("/modules/{module_id}/label")
def module_label(module_id: str, _user=Depends(require_user)) -> Response:
    return _label_response("module", module_id)


@router.get("/equipment/{equipment_id}/label")
def equipment_label(equipment_id: str, _user=Depends(require_user)) -> Response:
    return _label_response("equipment", equipment_id)


@router.get("/spare-parts/{part_id}/label")
def sparepart_label(part_id: str, _user=Depends(require_user)) -> Response:
    return _label_response("sparepart", part_id)
