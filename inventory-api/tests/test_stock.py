from .conftest import READONLY, STAFF


def test_adjust_and_read(client, product, warehouse):
    r = client.post(
        "/stock/adjust",
        json={
            "product_id": product["id"],
            "warehouse_id": warehouse["id"],
            "delta": 25,
            "reason": "receipt",
        },
        headers=STAFF,
    )
    assert r.status_code == 200
    assert r.json()["on_hand"] == 25
    assert r.json()["available"] == 25

    levels = client.get(f"/stock/{product['id']}", headers=READONLY).json()
    assert levels[0]["on_hand"] == 25


def test_moves_are_logged(client, product, warehouse):
    for delta in (10, -3, 5):
        client.post(
            "/stock/adjust",
            json={
                "product_id": product["id"],
                "warehouse_id": warehouse["id"],
                "delta": delta,
                "reason": "count",
            },
            headers=STAFF,
        )
    moves = client.get(f"/stock/{product['id']}/moves", headers=READONLY).json()
    assert len(moves) == 3
