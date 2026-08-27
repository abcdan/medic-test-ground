"""Purchasing suggestions from the low stock report."""

from ..config import settings
from ..repositories import products as product_repo
from ..repositories import stock as stock_repo


def suggestions() -> list:
    """One row per product that has fallen to or below its reorder point."""
    rows = stock_repo.low_stock(settings.low_stock_threshold)

    out = []
    for row in rows:
        product = product_repo.get_product(row["product_id"])
        supplier = None
        if product["supplier_id"]:
            supplier = product_repo.get_supplier(product["supplier_id"])

        out.append(
            {
                "product_id": row["product_id"],
                "sku": row["sku"],
                "name": row["name"],
                "on_hand": row["on_hand"],
                "reorder_point": row["reorder_point"],
                "reorder_qty": row["reorder_qty"],
                "supplier_email": supplier["email"] if supplier else None,
            }
        )
    return out


def purchase_order_lines() -> list:
    """Group the suggestions by supplier so one PO goes out per supplier."""
    grouped: dict = {}
    for row in suggestions():
        email = row["supplier_email"] or "unassigned"
        grouped.setdefault(email, []).append(row)
    return [{"supplier_email": email, "lines": lines} for email, lines in grouped.items()]
