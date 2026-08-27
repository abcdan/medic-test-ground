from .conftest import STAFF


def stock_up(client, product, warehouse, qty):
    client.post(
        "/stock/adjust",
        json={
            "product_id": product["id"],
            "warehouse_id": warehouse["id"],
            "delta": qty,
            "reason": "receipt",
        },
        headers=STAFF,
    )


def test_order_lifecycle(client, product, warehouse):
    stock_up(client, product, warehouse, 50)

    order = client.post(
        "/orders",
        json={
            "customer": "acme",
            "warehouse_id": warehouse["id"],
            "lines": [{"product_id": product["id"], "quantity": 5}],
        },
        headers=STAFF,
    ).json()

    assert order["status"] == "draft"
    assert order["subtotal"] == 50.0

    confirmed = client.post(f"/orders/{order['id']}/confirm", headers=STAFF).json()
    assert confirmed["status"] == "confirmed"

    levels = client.get(f"/stock/{product['id']}", headers=STAFF).json()
    assert levels[0]["reserved"] == 5
    assert levels[0]["available"] == 45

    shipped = client.post(f"/orders/{order['id']}/ship", headers=STAFF).json()
    assert shipped["status"] == "shipped"

    levels = client.get(f"/stock/{product['id']}", headers=STAFF).json()
    assert levels[0]["on_hand"] == 45
    assert levels[0]["reserved"] == 0


def test_cancel_releases_reservation(client, product, warehouse):
    stock_up(client, product, warehouse, 20)
    order = client.post(
        "/orders",
        json={
            "customer": "acme",
            "warehouse_id": warehouse["id"],
            "lines": [{"product_id": product["id"], "quantity": 8}],
        },
        headers=STAFF,
    ).json()

    client.post(f"/orders/{order['id']}/confirm", headers=STAFF)
    client.post(f"/orders/{order['id']}/cancel", headers=STAFF)

    levels = client.get(f"/stock/{product['id']}", headers=STAFF).json()
    assert levels[0]["reserved"] == 0
    assert levels[0]["on_hand"] == 20


def test_confirm_without_stock_fails(client, product, warehouse):
    order = client.post(
        "/orders",
        json={
            "customer": "acme",
            "warehouse_id": warehouse["id"],
            "lines": [{"product_id": product["id"], "quantity": 3}],
        },
        headers=STAFF,
    ).json()
    r = client.post(f"/orders/{order['id']}/confirm", headers=STAFF)
    assert r.status_code == 409
