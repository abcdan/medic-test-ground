"""SQLite access layer.

One connection per process, shared across requests. SQLite serialises
writes internally so a connection pool would not buy us anything here.
"""

import sqlite3
import threading
from contextlib import contextmanager

from .config import settings

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS suppliers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    email        TEXT NOT NULL,
    lead_days    INTEGER NOT NULL DEFAULT 7,
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    sku           TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    description   TEXT,
    supplier_id   INTEGER REFERENCES suppliers(id),
    unit_price    REAL NOT NULL,
    cost_price    REAL NOT NULL DEFAULT 0,
    reorder_point INTEGER NOT NULL DEFAULT 0,
    reorder_qty   INTEGER NOT NULL DEFAULT 0,
    discontinued  INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS warehouses (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    code    TEXT NOT NULL UNIQUE,
    name    TEXT NOT NULL,
    region  TEXT NOT NULL DEFAULT 'eu'
);

CREATE TABLE IF NOT EXISTS stock (
    product_id   INTEGER NOT NULL REFERENCES products(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    on_hand      INTEGER NOT NULL DEFAULT 0,
    reserved     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS stock_moves (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id   INTEGER NOT NULL REFERENCES products(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    delta        INTEGER NOT NULL,
    reason       TEXT NOT NULL,
    reference    TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    reference    TEXT NOT NULL UNIQUE,
    customer     TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'draft',
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    subtotal     REAL NOT NULL DEFAULT 0,
    tax          REAL NOT NULL DEFAULT 0,
    total        REAL NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS order_lines (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity   INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    discount   REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reservations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id     INTEGER NOT NULL REFERENCES orders(id),
    product_id   INTEGER NOT NULL REFERENCES products(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    quantity     INTEGER NOT NULL,
    expires_at   TEXT NOT NULL,
    released     INTEGER NOT NULL DEFAULT 0
);
"""


def connect() -> sqlite3.Connection:
    """Return this thread's connection, opening it on first use."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(settings.database_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        _local.conn = conn
    return conn


def init_db() -> None:
    """Create the schema if it is not there yet."""
    conn = connect()
    conn.executescript(SCHEMA)
    conn.commit()


def use_database(path: str) -> None:
    """Point the process at a different database file.

    Drops every cached connection so each thread reopens against the new
    path on next use. Used by the tests to get an isolated database.
    """
    global _local
    settings.database_path = path
    _local = threading.local()


def reset_db() -> None:
    """Drop everything. Only used by the tests."""
    conn = connect()
    for table in (
        "reservations",
        "order_lines",
        "orders",
        "stock_moves",
        "stock",
        "warehouses",
        "products",
        "suppliers",
    ):
        conn.execute(f"DROP TABLE IF EXISTS {table}")
    conn.commit()
    init_db()


@contextmanager
def transaction():
    """Run a block inside a transaction, committing on success."""
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def query(sql: str, params=()) -> list:
    return connect().execute(sql, params).fetchall()


def query_one(sql: str, params=()):
    return connect().execute(sql, params).fetchone()


def execute(sql: str, params=()) -> int:
    conn = connect()
    cur = conn.execute(sql, params)
    conn.commit()
    return cur.lastrowid
