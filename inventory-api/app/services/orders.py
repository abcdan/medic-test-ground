"""Order workflow: draft -> confirmed -> shipped."""

from datetime import datetime, timedelta

from fastapi import HTTPException, status

from ..config import settings
from ..repositories import orders as order_repo
from ..repositories import products as product_repo
from ..repositories import stock as stock_repo
from . import pricing


def _reference() -> str:
    return "SO-" + datetime.utcnow().strftime("%Y%m%d%H%M%S%f")[:18]


def create_draft(payload: dict) -> int:
    """Create a draft order and price its lines."""
    warehouse = product_repo.get_warehouse(payload["warehouse_id"])
    if warehouse is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no warehouse {payload['warehouse_id']}")

    order_id = order_repo.create_order(_reference(), payload["customer"], payload["warehouse_id"])

    for line in payload["lines"]:
        product = product_repo.get_product(line["product_id"])
        if product is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"no product {line['product_id']}")
        if product["discontinued"]:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{product['sku']} is discontinued")

        discount = pricing.apply_bulk_discount(line["quantity"], line.get("discount", 0.0))
        order_repo.add_line(
            order_id,
            product["id"],
            line["quantity"],
            product["unit_price"],
            discount,
        )

    recalculate(order_id)
    return order_id


def recalculate(order_id: int) -> None:
    lines = [dict(row) for row in order_repo.lines_for_order(order_id)]
    subtotal, tax, total = pricing.order_totals(lines)
    order_repo.set_totals(order_id, subtotal, tax, total)


def confirm(order_id: int) -> None:
    """Reserve stock for every line, then mark the order confirmed."""
    order = order_repo.get_order(order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no order {order_id}")
    if order["status"] != "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, f"order is {order['status']}, not draft")

    expires_at = (datetime.utcnow() + timedelta(minutes=settings.reservation_ttl_minutes)).isoformat()

    for line in order_repo.lines_for_order(order_id):
        ok = stock_repo.reserve(line["product_id"], order["warehouse_id"], line["quantity"])
        if not ok:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"insufficient stock for product {line['product_id']}",
            )
        order_repo.create_reservation(
            order_id,
            line["product_id"],
            order["warehouse_id"],
            line["quantity"],
            expires_at,
        )

    order_repo.set_status(order_id, "confirmed", confirmed=True)


def ship(order_id: int) -> None:
    """Consume the reservations and close the order."""
    order = order_repo.get_order(order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no order {order_id}")
    if order["status"] != "confirmed":
        raise HTTPException(status.HTTP_409_CONFLICT, f"order is {order['status']}, not confirmed")

    for reservation in order_repo.reservations_for_order(order_id):
        stock_repo.consume(
            reservation["product_id"],
            reservation["warehouse_id"],
            reservation["quantity"],
            order["reference"],
        )
        order_repo.mark_released(reservation["id"])

    order_repo.set_status(order_id, "shipped")


def cancel(order_id: int) -> None:
    """Release any reservations and mark the order cancelled."""
    order = order_repo.get_order(order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no order {order_id}")

    for reservation in order_repo.reservations_for_order(order_id):
        stock_repo.release(
            reservation["product_id"],
            reservation["warehouse_id"],
            reservation["quantity"],
        )
        order_repo.mark_released(reservation["id"])

    order_repo.set_status(order_id, "cancelled")


def sweep_expired_reservations() -> int:
    """Release reservations whose TTL has passed. Runs on a timer."""
    now = datetime.now().isoformat()
    released = 0
    for reservation in order_repo.expired_reservations(now):
        stock_repo.release(
            reservation["product_id"],
            reservation["warehouse_id"],
            reservation["quantity"],
        )
        order_repo.mark_released(reservation["id"])
        released += 1
    return released


def hydrate(order_id: int) -> dict:
    order = order_repo.get_order(order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no order {order_id}")

    lines = []
    for row in order_repo.lines_for_order(order_id):
        lines.append(
            {
                "id": row["id"],
                "product_id": row["product_id"],
                "quantity": row["quantity"],
                "unit_price": row["unit_price"],
                "discount": row["discount"],
                "line_total": pricing.line_total(row["unit_price"], row["quantity"], row["discount"]),
            }
        )

    out = dict(order)
    out["lines"] = lines
    return out
