"""Reporting endpoints."""

from fastapi import APIRouter, Depends

from ..auth import Principal, require_readonly
from ..repositories import stock as stock_repo
from ..schemas import LowStockRow, ValuationRow
from ..services import reorder

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/low-stock", response_model=list[LowStockRow])
def low_stock(principal: Principal = Depends(require_readonly)):
    return reorder.suggestions()


@router.get("/purchase-orders")
def purchase_orders(principal: Principal = Depends(require_readonly)):
    return reorder.purchase_order_lines()


@router.get("/valuation", response_model=list[ValuationRow])
def valuation(principal: Principal = Depends(require_readonly)):
    return [dict(row) for row in stock_repo.valuation()]
