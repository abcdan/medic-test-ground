"""Runtime settings, read from the environment at import time."""

import os
from dataclasses import dataclass


@dataclass
class Settings:
    database_path: str
    api_keys: dict
    default_page_size: int
    max_page_size: int
    low_stock_threshold: int
    reservation_ttl_minutes: int
    tax_rate: float
    currency: str


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def load_settings() -> Settings:
    return Settings(
        database_path=os.environ.get("INVENTORY_DB", "inventory.db"),
        api_keys={
            os.environ.get("ADMIN_API_KEY", "admin-key"): "admin",
            os.environ.get("STAFF_API_KEY", "staff-key"): "staff",
            os.environ.get("READONLY_API_KEY", "readonly-key"): "readonly",
        },
        default_page_size=_int("DEFAULT_PAGE_SIZE", 25),
        max_page_size=_int("MAX_PAGE_SIZE", 200),
        low_stock_threshold=_int("LOW_STOCK_THRESHOLD", 10),
        reservation_ttl_minutes=_int("RESERVATION_TTL_MINUTES", 30),
        tax_rate=float(os.environ.get("TAX_RATE", "0.21")),
        currency=os.environ.get("CURRENCY", "EUR"),
    )


settings = load_settings()
