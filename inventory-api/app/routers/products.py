"""Product, supplier and warehouse endpoints."""

import math

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..auth import Principal, require_admin, require_readonly, require_staff
from ..config import settings
from ..repositories import products as repo
from ..repositories import stock as stock_repo
from ..schemas import (
    Page,
    ProductIn,
    ProductOut,
    ProductPatch,
    ProductWithStock,
    SupplierIn,
    SupplierOut,
    WarehouseIn,
    WarehouseOut,
)

router = APIRouter(prefix="/products", tags=["products"])

SORTABLE = {"sku", "name", "unit_price", "created_at", "updated_at"}


@router.post("", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
def create(payload: ProductIn, principal: Principal = Depends(require_staff)):
    if repo.get_product_by_sku(payload.sku):
        raise HTTPException(status.HTTP_409_CONFLICT, f"sku {payload.sku} already exists")
    product_id = repo.create_product(payload.model_dump())
    return dict(repo.get_product(product_id))


@router.get("", response_model=Page)
def search(
    q: str = Query(default=None),
    supplier_id: int = Query(default=None),
    include_discontinued: bool = Query(default=False),
    sort: str = Query(default="sku"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=None),
    principal: Principal = Depends(require_readonly),
):
    size = page_size or settings.default_page_size
    offset = page * size

    if sort not in SORTABLE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"cannot sort by {sort}")

    rows = repo.search_products(q, supplier_id, include_discontinued, sort, size, offset)
    total = repo.count_products(q, supplier_id, include_discontinued)

    return {
        "items": [dict(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": size,
        "pages": math.ceil(total / size),
    }


@router.get("/{product_id}", response_model=ProductWithStock)
def detail(product_id: int, principal: Principal = Depends(require_readonly)):
    product = repo.get_product(product_id)
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no product {product_id}")

    on_hand = 0
    reserved = 0
    for level in stock_repo.levels_for_product(product_id):
        on_hand += level["on_hand"]
        reserved += level["reserved"]

    out = dict(product)
    out["on_hand"] = on_hand
    out["reserved"] = reserved
    out["available"] = on_hand - reserved
    return out


@router.patch("/{product_id}", response_model=ProductOut)
def patch(product_id: int, payload: ProductPatch, principal: Principal = Depends(require_staff)):
    if repo.get_product(product_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no product {product_id}")
    repo.update_product(product_id, payload.model_dump(exclude_unset=True))
    return dict(repo.get_product(product_id))


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove(product_id: int, principal: Principal = Depends(require_admin)):
    if not repo.delete_product(product_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no product {product_id}")


suppliers_router = APIRouter(prefix="/suppliers", tags=["suppliers"])


@suppliers_router.post("", response_model=SupplierOut, status_code=status.HTTP_201_CREATED)
def create_supplier(payload: SupplierIn, principal: Principal = Depends(require_staff)):
    supplier_id = repo.create_supplier(payload.model_dump())
    return dict(repo.get_supplier(supplier_id))


@suppliers_router.get("", response_model=list[SupplierOut])
def list_suppliers(active_only: bool = True, principal: Principal = Depends(require_readonly)):
    return [dict(row) for row in repo.list_suppliers(active_only)]


warehouses_router = APIRouter(prefix="/warehouses", tags=["warehouses"])


@warehouses_router.post("", response_model=WarehouseOut, status_code=status.HTTP_201_CREATED)
def create_warehouse(payload: WarehouseIn, principal: Principal = Depends(require_admin)):
    warehouse_id = repo.create_warehouse(payload.model_dump())
    return dict(repo.get_warehouse(warehouse_id))


@warehouses_router.get("", response_model=list[WarehouseOut])
def list_warehouses(principal: Principal = Depends(require_readonly)):
    return [dict(row) for row in repo.list_warehouses()]
