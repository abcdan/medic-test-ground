import test from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import * as M from "../src/domain/money";
import { DEFAULT_ZONES, findZone, priceMethod, quote, type ShippingMethod } from "../src/domain/shipping";
import { SearchIndex, tokenise, stem } from "../src/search";
import type { Product, Variant } from "../src/domain/catalog";

const parcel = (grams: number, value: number) => ({
  weightGrams: grams,
  itemCount: 1,
  value: M.money(value),
  hasDigitalOnly: false,
});

function method(overrides: Partial<ShippingMethod> = {}): ShippingMethod {
  return {
    id: "std",
    zoneId: "nl",
    name: "Standard",
    description: "2-3 working days",
    kind: "weight",
    flatPrice: null,
    weightBands: [
      { minGrams: 0, maxGrams: 1000, price: M.money(395) },
      { minGrams: 1000, maxGrams: 5000, price: M.money(695) },
      { minGrams: 5000, maxGrams: 20000, price: M.money(1295) },
    ],
    priceBands: [],
    freeOver: M.money(5000),
    minDays: 2,
    maxDays: 3,
    carrier: "postnl",
    requiresShipping: true,
    active: true,
    position: 0,
    ...overrides,
  };
}

test("finds the most specific zone", () => {
  assert.equal(findZone(DEFAULT_ZONES, { countryCode: "NL", regionCode: "", postalCode: "1011" })?.id, "nl");
  assert.equal(findZone(DEFAULT_ZONES, { countryCode: "DE", regionCode: "", postalCode: "10115" })?.id, "be-de");
  assert.equal(findZone(DEFAULT_ZONES, { countryCode: "AU", regionCode: "", postalCode: "2000" })?.id, "world");
});

test("prices by weight band", () => {
  assert.equal(priceMethod(method(), parcel(500, 1000))?.amount, 395);
  assert.equal(priceMethod(method(), parcel(2000, 1000))?.amount, 695);
});

test("free over a threshold", () => {
  assert.equal(priceMethod(method(), parcel(500, 6000))?.amount, 0);
});

test("quotes are sorted cheapest first", () => {
  const quotes = quote(
    DEFAULT_ZONES,
    [method(), method({ id: "express", name: "Express", kind: "flat", flatPrice: M.money(995), weightBands: [], freeOver: null })],
    { countryCode: "NL", regionCode: "", postalCode: "1011AB" },
    parcel(500, 1000),
  );

  assert.equal(quotes.length, 2);
  assert.equal(quotes[0].methodId, "std");
});

function product(title: string, tags: string[], type: string): Product {
  return {
    id: randomUUID(),
    handle: title.toLowerCase().replace(/\s/g, "-"),
    title,
    description: `A very nice ${title}`,
    vendor: "Acme",
    productType: type,
    status: "active",
    options: [],
    variantIds: [],
    imageIds: [],
    collectionIds: [],
    tags,
    seoTitle: "",
    seoDescription: "",
    publishedAt: "2026-01-01",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
}

function variantFor(productId: string, price: number): Variant {
  return {
    id: randomUUID(),
    productId,
    sku: `sku-${price}`,
    barcode: null,
    optionValues: [],
    price: M.money(price),
    compareAtPrice: null,
    costPrice: null,
    weightGrams: 100,
    lengthMm: 10,
    widthMm: 10,
    heightMm: 10,
    requiresShipping: true,
    taxCode: "standard",
    imageIds: [],
    position: 0,
    active: true,
  };
}

test("tokenising drops stop words", () => {
  assert.deepEqual(tokenise("The quick brown fox"), ["quick", "brown", "fox"]);
});

test("stemming handles plurals", () => {
  assert.equal(stem("boxes"), "box");
  assert.equal(stem("berries"), "berry");
  assert.equal(stem("running"), "runn");
});

test("search finds by title and filters by facet", () => {
  const index = new SearchIndex();

  const shirt = product("Linen Shirt", ["summer", "linen"], "Shirts");
  const trousers = product("Wool Trousers", ["winter", "wool"], "Trousers");

  index.index(shirt, [variantFor(shirt.id, 8900)]);
  index.index(trousers, [variantFor(trousers.id, 12900)]);

  const byTerm = index.search({ term: "linen" });
  assert.equal(byTerm.total, 1);
  assert.equal(byTerm.hits[0].product.title, "Linen Shirt");

  const byType = index.search({ term: "", productTypes: ["Trousers"] });
  assert.equal(byType.total, 1);

  const byPrice = index.search({ term: "", maxPrice: 10000 });
  assert.equal(byPrice.total, 1);
});

test("suggest matches a prefix", () => {
  const index = new SearchIndex();
  const shirt = product("Linen Shirt", [], "Shirts");
  index.index(shirt, [variantFor(shirt.id, 8900)]);
  assert.deepEqual(index.suggest("lin"), ["Linen Shirt"]);
});
