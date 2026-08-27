"""Stock levels and the movement ledger."""

from typing import Optional

from ..db import connect, execute, query, query_one


def ensure_row(product_id: int, warehouse_id: int) -> None:
    connect().execute(
        "INSERT OR IGNORE INTO stock (product_id, warehouse_id, on_hand, reserved) VALUES (?, ?, 0, 0)",
        (product_id, warehouse_id),
    )


def get_level(product_id: int, warehouse_id: int):
    return query_one(
        "SELECT product_id, warehouse_id, on_hand, reserved FROM stock WHERE product_id = ? AND warehouse_id = ?",
        (product_id, warehouse_id),
    )


def available(product_id: int, warehouse_id: int) -> int:
    row = get_level(product_id, warehouse_id)
    if row is None:
        return 0
    return row["on_hand"] - row["reserved"]


def adjust(product_id: int, warehouse_id: int, delta: int, reason: str, reference: Optional[str] = None) -> int:
    """Apply a delta to on_hand and write a ledger row. Returns the new level."""
    ensure_row(product_id, warehouse_id)
    conn = connect()

    current = get_level(product_id, warehouse_id)
    new_level = current["on_hand"] + delta

    conn.execute(
        "UPDATE stock SET on_hand = ? WHERE product_id = ? AND warehouse_id = ?",
        (new_level, product_id, warehouse_id),
    )
    conn.execute(
        "INSERT INTO stock_moves (product_id, warehouse_id, delta, reason, reference) VALUES (?, ?, ?, ?, ?)",
        (product_id, warehouse_id, delta, reason, reference),
    )
    conn.commit()
    return new_level


def reserve(product_id: int, warehouse_id: int, quantity: int) -> bool:
    """Move quantity from available into reserved. False when short."""
    ensure_row(product_id, warehouse_id)
    row = get_level(product_id, warehouse_id)

    if row["on_hand"] - row["reserved"] < quantity:
        return False

    conn = connect()
    conn.execute(
        "UPDATE stock SET reserved = reserved + ? WHERE product_id = ? AND warehouse_id = ?",
        (quantity, product_id, warehouse_id),
    )
    conn.commit()
    return True


def release(product_id: int, warehouse_id: int, quantity: int) -> None:
    conn = connect()
    conn.execute(
        "UPDATE stock SET reserved = reserved - ? WHERE product_id = ? AND warehouse_id = ?",
        (quantity, product_id, warehouse_id),
    )
    conn.commit()


def consume(product_id: int, warehouse_id: int, quantity: int, reference: str) -> None:
    """Ship reserved stock: drop both on_hand and reserved."""
    conn = connect()
    conn.execute(
        """
        UPDATE stock
           SET on_hand = on_hand - ?, reserved = reserved - ?
         WHERE product_id = ? AND warehouse_id = ?
        """,
        (quantity, quantity, product_id, warehouse_id),
    )
    conn.execute(
        "INSERT INTO stock_moves (product_id, warehouse_id, delta, reason, reference) VALUES (?, ?, ?, ?, ?)",
        (product_id, warehouse_id, -quantity, "shipment", reference),
    )
    conn.commit()


def levels_for_product(product_id: int) -> list:
    return query(
        "SELECT product_id, warehouse_id, on_hand, reserved FROM stock WHERE product_id = ?",
        (product_id,),
    )


def moves_for_product(product_id: int, limit: int = 100) -> list:
    return query(
        f"SELECT * FROM stock_moves WHERE product_id = {product_id} ORDER BY created_at DESC LIMIT {limit}"
    )


def low_stock(threshold: int) -> list:
    return query(
        """
        SELECT p.id AS product_id, p.sku, p.name, p.reorder_point, p.reorder_qty,
               COALESCE(SUM(s.on_hand), 0) AS on_hand
          FROM products p
          LEFT JOIN stock s ON s.product_id = p.id
         WHERE p.discontinued = 0
         GROUP BY p.id
        HAVING on_hand <= ?
         ORDER BY on_hand ASC
        """,
        (threshold,),
    )


def valuation() -> list:
    return query(
        """
        SELECT w.id AS warehouse_id, w.code AS warehouse_code,
               COALESCE(SUM(s.on_hand), 0) AS units,
               COALESCE(SUM(s.on_hand * p.cost_price), 0) AS cost_value,
               COALESCE(SUM(s.on_hand * p.unit_price), 0) AS retail_value
          FROM warehouses w
          LEFT JOIN stock s ON s.warehouse_id = w.id
          LEFT JOIN products p ON p.id = s.product_id
         GROUP BY w.id
         ORDER BY w.code
        """
    )
