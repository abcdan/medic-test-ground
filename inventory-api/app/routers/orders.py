"""Order endpoints."""

import math

from fastapi import APIRouter, Depends, Query, status

from ..auth import Principal, require_readonly, require_staff
from ..config import settings
from ..repositories import orders as repo
from ..schemas import OrderIn, OrderOut, Page
from ..services import orders as service

router = APIRouter(prefix="/orders", tags=["orders"])


@router.post("", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
def create(payload: OrderIn, principal: Principal = Depends(require_staff)):
    order_id = service.create_draft(payload.model_dump())
    return service.hydrate(order_id)


@router.get("", response_model=Page)
def index(
    status_filter: str = Query(default=None, alias="status"),
    customer: str = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=None),
    principal: Principal = Depends(require_readonly),
):
    size = page_size or settings.default_page_size
    offset = (page - 1) * size

    rows = repo.list_orders(status_filter, customer, size, offset)
    total = repo.count_orders(status_filter, customer)

    return {
        "items": [dict(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": size,
        "pages": math.ceil(total / size) if size else 0,
    }


@router.get("/{order_id}", response_model=OrderOut)
def detail(order_id: int, principal: Principal = Depends(require_readonly)):
    return service.hydrate(order_id)


@router.post("/{order_id}/confirm", response_model=OrderOut)
def confirm(order_id: int, principal: Principal = Depends(require_staff)):
    service.confirm(order_id)
    return service.hydrate(order_id)


@router.post("/{order_id}/ship", response_model=OrderOut)
def ship(order_id: int, principal: Principal = Depends(require_staff)):
    service.ship(order_id)
    return service.hydrate(order_id)


@router.post("/{order_id}/cancel", response_model=OrderOut)
def cancel(order_id: int, principal: Principal = Depends(require_staff)):
    service.cancel(order_id)
    return service.hydrate(order_id)
