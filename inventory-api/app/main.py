"""FastAPI application entrypoint."""

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .config import settings
from .db import init_db
from .routers import orders, products, reports, stock
from .services.orders import sweep_expired_reservations

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("inventory")

app = FastAPI(title="inventory-api", version="0.1.0")

app.include_router(products.router)
app.include_router(products.suppliers_router)
app.include_router(products.warehouses_router)
app.include_router(stock.router)
app.include_router(orders.router)
app.include_router(reports.router)


@app.on_event("startup")
def startup() -> None:
    init_db()
    log.info("inventory-api ready, db=%s currency=%s", settings.database_path, settings.currency)


@app.get("/health")
def health():
    return {"ok": True, "currency": settings.currency, "tax_rate": settings.tax_rate}


@app.post("/maintenance/sweep-reservations")
def sweep():
    released = sweep_expired_reservations()
    return {"released": released}


@app.exception_handler(Exception)
def unhandled(request: Request, exc: Exception):
    log.exception("unhandled error on %s %s", request.method, request.url)
    return JSONResponse(status_code=500, content={"detail": str(exc)})
