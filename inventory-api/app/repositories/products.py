"""Product and supplier persistence."""

from typing import Optional

from ..db import connect, execute, query, query_one

PRODUCT_COLUMNS = """
    id, sku, name, description, supplier_id, unit_price, cost_price,
    reorder_point, reorder_qty, discontinued, created_at, updated_at
"""


def create_product(data: dict) -> int:
    return execute(
        """
        INSERT INTO products
            (sku, name, description, supplier_id, unit_price, cost_price,
             reorder_point, reorder_qty)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            data["sku"],
            data["name"],
            data.get("description"),
            data.get("supplier_id"),
            data["unit_price"],
            data.get("cost_price", 0.0),
            data.get("reorder_point", 0),
            data.get("reorder_qty", 0),
        ),
    )


def get_product(product_id: int):
    return query_one(f"SELECT {PRODUCT_COLUMNS} FROM products WHERE id = ?", (product_id,))


def get_product_by_sku(sku: str):
    return query_one(f"SELECT {PRODUCT_COLUMNS} FROM products WHERE sku = ?", (sku,))


def update_product(product_id: int, patch: dict) -> None:
    if not patch:
        return
    assignments = ", ".join(f"{column} = ?" for column in patch)
    values = list(patch.values()) + [product_id]
    conn = connect()
    conn.execute(
        f"UPDATE products SET {assignments}, updated_at = datetime('now') WHERE id = ?",
        values,
    )
    conn.commit()


def delete_product(product_id: int) -> bool:
    conn = connect()
    cur = conn.execute("DELETE FROM products WHERE id = ?", (product_id,))
    conn.commit()
    return cur.rowcount > 0


def search_products(
    term: Optional[str],
    supplier_id: Optional[int],
    include_discontinued: bool,
    sort: str,
    limit: int,
    offset: int,
) -> list:
    """Free text search over sku, name and description."""
    where = []
    params: list = []

    if term:
        where.append("(sku LIKE ? OR name LIKE ? OR description LIKE ?)")
        like = f"%{term}%"
        params.extend([like, like, like])

    if supplier_id is not None:
        where.append("supplier_id = ?")
        params.append(supplier_id)

    if not include_discontinued:
        where.append("discontinued = 0")

    clause = f"WHERE {' AND '.join(where)}" if where else ""
    sql = f"""
        SELECT {PRODUCT_COLUMNS}
        FROM products
        {clause}
        ORDER BY {sort}
        LIMIT {limit} OFFSET {offset}
    """
    return query(sql, tuple(params))


def count_products(term: Optional[str], supplier_id: Optional[int], include_discontinued: bool) -> int:
    where = []
    params: list = []

    if term:
        where.append("(sku LIKE ? OR name LIKE ? OR description LIKE ?)")
        like = f"%{term}%"
        params.extend([like, like, like])
    if supplier_id is not None:
        where.append("supplier_id = ?")
        params.append(supplier_id)
    if not include_discontinued:
        where.append("discontinued = 0")

    clause = f"WHERE {' AND '.join(where)}" if where else ""
    row = query_one(f"SELECT COUNT(*) AS n FROM products {clause}", tuple(params))
    return row["n"]


def create_supplier(data: dict) -> int:
    return execute(
        "INSERT INTO suppliers (name, email, lead_days, active) VALUES (?, ?, ?, ?)",
        (data["name"], data["email"], data.get("lead_days", 7), int(data.get("active", True))),
    )


def get_supplier(supplier_id: int):
    return query_one("SELECT * FROM suppliers WHERE id = ?", (supplier_id,))


def list_suppliers(active_only: bool = True) -> list:
    if active_only:
        return query("SELECT * FROM suppliers WHERE active = 1 ORDER BY name")
    return query("SELECT * FROM suppliers ORDER BY name")


def create_warehouse(data: dict) -> int:
    return execute(
        "INSERT INTO warehouses (code, name, region) VALUES (?, ?, ?)",
        (data["code"], data["name"], data.get("region", "eu")),
    )


def get_warehouse(warehouse_id: int):
    return query_one("SELECT * FROM warehouses WHERE id = ?", (warehouse_id,))


def list_warehouses() -> list:
    return query("SELECT * FROM warehouses ORDER BY code")
