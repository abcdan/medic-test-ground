from app.services import pricing


def test_line_total():
    assert pricing.line_total(10.0, 3, 0.0) == 30.0
    assert pricing.line_total(10.0, 3, 0.1) == 27.0


def test_order_totals():
    lines = [
        {"unit_price": 10.0, "quantity": 2, "discount": 0.0},
        {"unit_price": 5.0, "quantity": 4, "discount": 0.0},
    ]
    subtotal, tax, total = pricing.order_totals(lines)
    assert subtotal == 40.0
    assert tax == 8.4
    assert total == 48.4


def test_bulk_discount_tiers():
    assert pricing.apply_bulk_discount(1, 0.0) == 0.0
    assert pricing.apply_bulk_discount(10, 0.0) == 0.05
    assert pricing.apply_bulk_discount(50, 0.0) == 0.10
    assert pricing.apply_bulk_discount(100, 0.0) == 0.15


def test_margin():
    assert pricing.margin(10.0, 4.0) == 60.0
