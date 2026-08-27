# inventory-api

Warehouse inventory and order management on FastAPI + SQLite.

```
pip install -r requirements.txt
uvicorn app.main:app --reload
pytest -q
```

## Domain

```
suppliers ─< products ─< stock >─ warehouses
                 │         │
                 │         └─< stock_moves        (append-only ledger)
                 └─< order_lines >─ orders ─< reservations
```

Stock is tracked per (product, warehouse) as `on_hand` and `reserved`;
`available` is the difference. Every change to `on_hand` writes a row to
`stock_moves` so the ledger reconciles against the levels.

## Order lifecycle

| Status | Transition | Effect on stock |
| --- | --- | --- |
| `draft` | `POST /orders` | none, lines are priced |
| `confirmed` | `POST /orders/{id}/confirm` | reserves each line, TTL 30 min |
| `shipped` | `POST /orders/{id}/ship` | consumes the reservations |
| `cancelled` | `POST /orders/{id}/cancel` | releases the reservations |

Reservations expire; `POST /maintenance/sweep-reservations` releases the
stale ones and is meant to be hit from cron.

## Endpoints

```
POST   /products                 GET  /products            (search, paged)
GET    /products/{id}            PATCH /products/{id}      DELETE /products/{id}
POST   /suppliers                GET  /suppliers
POST   /warehouses               GET  /warehouses
POST   /stock/adjust             GET  /stock/{product_id}
GET    /stock/{product_id}/moves
POST   /orders                   GET  /orders              (filter, paged)
GET    /orders/{id}              POST /orders/{id}/confirm|ship|cancel
GET    /reports/low-stock        GET  /reports/purchase-orders
GET    /reports/valuation        GET  /health
```

## Auth

`x-api-key` maps to one of three roles, ranked `readonly < staff < admin`.
Reads need `readonly`, stock and order operations need `staff`, deleting
products and creating warehouses need `admin`.

## Configuration

| Var | Default | Meaning |
| --- | --- | --- |
| `INVENTORY_DB` | `inventory.db` | SQLite file |
| `ADMIN_API_KEY` / `STAFF_API_KEY` / `READONLY_API_KEY` | `*-key` | API keys |
| `DEFAULT_PAGE_SIZE` | `25` | Page size when unspecified |
| `MAX_PAGE_SIZE` | `200` | Upper bound on `page_size` |
| `LOW_STOCK_THRESHOLD` | `10` | Cutoff for the low stock report |
| `RESERVATION_TTL_MINUTES` | `30` | How long a confirm holds stock |
| `TAX_RATE` | `0.21` | Applied to the order subtotal |
| `CURRENCY` | `EUR` | Reporting currency |
