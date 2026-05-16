"""Procurement subsystem — RFQs, vendors, purchase orders.

Only the RFQ list endpoint is wired today (G4); the model is shaped so
later stories can layer in line items, vendors, and PO conversion
without breaking the public schema.
"""
from .models import RFQ, RFQStatus, get_store
from .router import router as procurement_router

__all__ = ["RFQ", "RFQStatus", "get_store", "procurement_router"]
