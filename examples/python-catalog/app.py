from flask import Flask, jsonify
from sqlalchemy import create_engine, text

app = Flask(__name__)
engine = create_engine("sqlite:///catalog.db")


def initialize_database():
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL)"))
        connection.execute(text("CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category_id INTEGER NOT NULL)"))
        count = connection.execute(text("SELECT COUNT(*) FROM products")).scalar_one()
        if count == 0:
            connection.execute(text("INSERT INTO categories (id, name) VALUES (1, 'Books'), (2, 'Games')"))
            connection.execute(text("INSERT INTO products (name, category_id) VALUES ('Field Notes', 1), ('Chess Set', 2), ('Atlas', 1)"))


@app.get("/products")
def list_products():
    with engine.connect() as connection:
        products = connection.execute(text("SELECT id, name, category_id FROM products ORDER BY name")).mappings().all()
        response = []

        for product in products:
            category = connection.execute(
                text("SELECT id, name FROM categories WHERE id = :category_id"),
                {"category_id": product["category_id"]},
            ).mappings().one()
            response.append({"id": product["id"], "name": product["name"], "category": dict(category)})

    return jsonify(response)


initialize_database()

if __name__ == "__main__":
    app.run()
