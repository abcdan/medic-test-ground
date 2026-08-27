"""Stock adjustment and inspection endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status

from ..auth import Principal, require_readonly, require_staff
from ..repositories import products as product_repo
from ..repositories import stock as repo
from ..schemas import StockAdjustment, StockLevel

router = APIRouter(prefix="/stock", tags=["stock"])


@router.post("/adjust", response_model=StockLevel)
def adjust(payload: StockAdjustment, principal: Principal = Depends(require_staff)):
    if product_repo.get_product(payload.product_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no product {payload.product_id}")
    if product_repo.get_warehouse(payload.warehouse_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no warehouse {payload.warehouse_id}")

    repo.adjust(
        payload.product_id,
        payload.warehouse_id,
        payload.delta,
        payload.reason,
        payload.reference,
    )

    row = repo.get_level(payload.product_id, payload.warehouse_id)
    return {
        "product_id": row["product_id"],
        "warehouse_id": row["warehouse_id"],
        "on_hand": row["on_hand"],
        "reserved": row["reserved"],
        "available": row["on_hand"] - row["reserved"],
    }


@router.get("/{product_id}", response_model=list[StockLevel])
def levels(product_id: int, principal: Principal = Depends(require_readonly)):
    out = []
    for row in repo.levels_for_product(product_id):
        out.append(
            {
                "product_id": row["product_id"],
                "warehouse_id": row["warehouse_id"],
                "on_hand": row["on_hand"],
                "reserved": row["reserved"],
                "available": row["on_hand"] - row["reserved"],
            }
        )
    return out


@router.get("/{product_id}/moves")
def moves(product_id: int, limit: int = 100, principal: Principal = Depends(require_readonly)):
    return [dict(row) for row in repo.moves_for_product(product_id, limit)]
