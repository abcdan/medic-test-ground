from .conftest import ADMIN, READONLY, STAFF


def test_create_and_fetch(client, product):
    r = client.get(f"/products/{product['id']}", headers=READONLY)
    assert r.status_code == 200
    assert r.json()["sku"] == "WIDGET-1"
    assert r.json()["available"] == 0


def test_duplicate_sku_rejected(client, product):
    r = client.post(
        "/products",
        json={"sku": "WIDGET-1", "name": "Other", "unit_price": 1.0},
        headers=STAFF,
    )
    assert r.status_code == 409


def test_readonly_cannot_write(client):
    r = client.post(
        "/products",
        json={"sku": "NOPE", "name": "Nope", "unit_price": 1.0},
        headers=READONLY,
    )
    assert r.status_code == 403


def test_unknown_key_rejected(client):
    r = client.get("/products", headers={"x-api-key": "bogus"})
    assert r.status_code == 401


def test_patch_product(client, product):
    r = client.patch(f"/products/{product['id']}", json={"unit_price": 12.5}, headers=STAFF)
    assert r.status_code == 200
    assert r.json()["unit_price"] == 12.5


def test_delete_requires_admin(client, product):
    assert client.delete(f"/products/{product['id']}", headers=STAFF).status_code == 403
    assert client.delete(f"/products/{product['id']}", headers=ADMIN).status_code == 204
