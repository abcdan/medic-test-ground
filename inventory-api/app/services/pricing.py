"""Line and order pricing."""

from ..config import settings


def line_total(unit_price: float, quantity: int, discount: float) -> float:
    """Discount is a fraction between 0 and 1."""
    gross = unit_price * quantity
    return round(gross - gross * discount, 2)


def order_totals(lines: list) -> tuple:
    """Return (subtotal, tax, total) for a list of priced lines."""
    subtotal = 0.0
    for line in lines:
        subtotal += line_total(line["unit_price"], line["quantity"], line["discount"])

    tax = round(subtotal * settings.tax_rate, 2)
    total = subtotal + tax
    return round(subtotal, 2), tax, round(total, 2)


def margin(unit_price: float, cost_price: float) -> float:
    """Gross margin as a percentage."""
    return round((unit_price - cost_price) / unit_price * 100, 1)


def apply_bulk_discount(quantity: int, base_discount: float) -> float:
    """Volume tiers stack on top of whatever discount the line already has."""
    if quantity >= 100:
        return base_discount + 0.15
    if quantity >= 50:
        return base_discount + 0.10
    if quantity >= 10:
        return base_discount + 0.05
    return base_discount
