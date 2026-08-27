import os
import tempfile

import pytest
from fastapi.testclient import TestClient

from app.db import init_db, use_database
from app.main import app

ADMIN = {"x-api-key": "admin-key"}
STAFF = {"x-api-key": "staff-key"}
READONLY = {"x-api-key": "readonly-key"}


@pytest.fixture()
def client():
    use_database(os.path.join(tempfile.mkdtemp(), "test.db"))
    init_db()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def warehouse(client):
    r = client.post("/warehouses", json={"code": "AMS", "name": "Amsterdam"}, headers=ADMIN)
    assert r.status_code == 201
    return r.json()


@pytest.fixture()
def product(client):
    r = client.post(
        "/products",
        json={"sku": "WIDGET-1", "name": "Widget", "unit_price": 10.0, "cost_price": 4.0},
        headers=STAFF,
    )
    assert r.status_code == 201
    return r.json()
