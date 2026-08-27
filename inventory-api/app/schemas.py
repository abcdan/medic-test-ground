"""Request and response models."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class SupplierIn(BaseModel):
    name: str
    email: str
    lead_days: int = 7
    active: bool = True


class SupplierOut(BaseModel):
    id: int
    name: str
    email: str
    lead_days: int
    active: bool
    created_at: str


class ProductIn(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    name: str
    description: Optional[str] = None
    supplier_id: Optional[int] = None
    unit_price: float
    cost_price: float = 0.0
    reorder_point: int = 0
    reorder_qty: int = 0


class ProductPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    supplier_id: Optional[int] = None
    unit_price: Optional[float] = None
    cost_price: Optional[float] = None
    reorder_point: Optional[int] = None
    reorder_qty: Optional[int] = None
    discontinued: Optional[bool] = None


class ProductOut(BaseModel):
    id: int
    sku: str
    name: str
    description: Optional[str]
    supplier_id: Optional[int]
    unit_price: float
    cost_price: float
    reorder_point: int
    reorder_qty: int
    discontinued: bool
    created_at: str
    updated_at: str


class ProductWithStock(ProductOut):
    on_hand: int
    reserved: int
    available: int


class WarehouseIn(BaseModel):
    code: str
    name: str
    region: str = "eu"


class WarehouseOut(BaseModel):
    id: int
    code: str
    name: str
    region: str


class StockAdjustment(BaseModel):
    product_id: int
    warehouse_id: int
    delta: int
    reason: str
    reference: Optional[str] = None


class StockLevel(BaseModel):
    product_id: int
    warehouse_id: int
    on_hand: int
    reserved: int
    available: int


class OrderLineIn(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)
    discount: float = 0.0


class OrderIn(BaseModel):
    customer: str
    warehouse_id: int
    lines: list[OrderLineIn]


class OrderLineOut(BaseModel):
    id: int
    product_id: int
    quantity: int
    unit_price: float
    discount: float
    line_total: float


class OrderOut(BaseModel):
    id: int
    reference: str
    customer: str
    status: str
    warehouse_id: int
    subtotal: float
    tax: float
    total: float
    created_at: str
    confirmed_at: Optional[str]
    lines: list[OrderLineOut]


class Page(BaseModel):
    items: list
    total: int
    page: int
    page_size: int
    pages: int


class LowStockRow(BaseModel):
    product_id: int
    sku: str
    name: str
    on_hand: int
    reorder_point: int
    reorder_qty: int
    supplier_email: Optional[str]


class ValuationRow(BaseModel):
    warehouse_id: int
    warehouse_code: str
    units: int
    cost_value: float
    retail_value: float
