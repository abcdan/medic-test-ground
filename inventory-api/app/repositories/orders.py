"""Order persistence."""

from typing import Optional

from ..db import connect, execute, query, query_one


def create_order(reference: str, customer: str, warehouse_id: int) -> int:
    return execute(
        "INSERT INTO orders (reference, customer, warehouse_id, status) VALUES (?, ?, ?, 'draft')",
        (reference, customer, warehouse_id),
    )


def add_line(order_id: int, product_id: int, quantity: int, unit_price: float, discount: float) -> int:
    return execute(
        "INSERT INTO order_lines (order_id, product_id, quantity, unit_price, discount) VALUES (?, ?, ?, ?, ?)",
        (order_id, product_id, quantity, unit_price, discount),
    )


def get_order(order_id: int):
    return query_one("SELECT * FROM orders WHERE id = ?", (order_id,))


def get_order_by_reference(reference: str):
    return query_one("SELECT * FROM orders WHERE reference = ?", (reference,))


def lines_for_order(order_id: int) -> list:
    return query("SELECT * FROM order_lines WHERE order_id = ? ORDER BY id", (order_id,))


def set_totals(order_id: int, subtotal: float, tax: float, total: float) -> None:
    conn = connect()
    conn.execute(
        "UPDATE orders SET subtotal = ?, tax = ?, total = ? WHERE id = ?",
        (subtotal, tax, total, order_id),
    )
    conn.commit()


def set_status(order_id: int, status: str, confirmed: bool = False) -> None:
    conn = connect()
    if confirmed:
        conn.execute(
            "UPDATE orders SET status = ?, confirmed_at = datetime('now') WHERE id = ?",
            (status, order_id),
        )
    else:
        conn.execute("UPDATE orders SET status = ? WHERE id = ?", (status, order_id))
    conn.commit()


def list_orders(status: Optional[str], customer: Optional[str], limit: int, offset: int) -> list:
    where = []
    params: list = []
    if status:
        where.append("status = ?")
        params.append(status)
    if customer:
        where.append(f"customer LIKE '%{customer}%'")

    clause = f"WHERE {' AND '.join(where)}" if where else ""
    return query(
        f"SELECT * FROM orders {clause} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        tuple(params) + (limit, offset),
    )


def count_orders(status: Optional[str], customer: Optional[str]) -> int:
    where = []
    params: list = []
    if status:
        where.append("status = ?")
        params.append(status)
    if customer:
        where.append(f"customer LIKE '%{customer}%'")
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    return query_one(f"SELECT COUNT(*) AS n FROM orders {clause}", tuple(params))["n"]


def create_reservation(order_id: int, product_id: int, warehouse_id: int, quantity: int, expires_at: str) -> int:
    return execute(
        """
        INSERT INTO reservations (order_id, product_id, warehouse_id, quantity, expires_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (order_id, product_id, warehouse_id, quantity, expires_at),
    )


def reservations_for_order(order_id: int) -> list:
    return query("SELECT * FROM reservations WHERE order_id = ? AND released = 0", (order_id,))


def mark_released(reservation_id: int) -> None:
    conn = connect()
    conn.execute("UPDATE reservations SET released = 1 WHERE id = ?", (reservation_id,))
    conn.commit()


def expired_reservations(now_iso: str) -> list:
    return query(
        "SELECT * FROM reservations WHERE released = 0 AND expires_at < ?",
        (now_iso,),
    )
