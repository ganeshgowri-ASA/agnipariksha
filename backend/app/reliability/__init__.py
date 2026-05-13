"""Reliability analytics: MTBF/MTTR, Weibull fits, predictive risk, spares."""
from .models import (
    MaintenanceTicket,
    SparePart,
    EquipmentHealth,
    ReliabilityStore,
    get_store,
)
from .mtbf import compute_mtbf_mttr, availability
from .weibull import weibull_fit, weibull_cdf
from .predictive import risk_score, next_service_due, equipment_health
from .inventory import (
    create_part,
    update_part,
    delete_part,
    list_parts,
    consume_part,
    check_reorder,
)
from .router import router as reliability_router

__all__ = [
    "MaintenanceTicket",
    "SparePart",
    "EquipmentHealth",
    "ReliabilityStore",
    "get_store",
    "compute_mtbf_mttr",
    "availability",
    "weibull_fit",
    "weibull_cdf",
    "risk_score",
    "next_service_due",
    "equipment_health",
    "create_part",
    "update_part",
    "delete_part",
    "list_parts",
    "consume_part",
    "check_reorder",
    "reliability_router",
]
