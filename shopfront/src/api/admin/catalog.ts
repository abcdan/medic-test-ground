import { randomUUID } from "node:crypto";
import { Router } from "../router";
import { badRequest, created, field, intQuery, noContent, notFound, ok, optionalField, type Request } from "../middleware";
import type { Store } from "../../store/repositories";
import type { SearchIndex } from "../../search";
import type { EventBus } from "../../events/bus";
import {
  marginPercent,
  matchesRules,
  optionCombinations,
  slugify,
  type Product,
  type Variant,
} from "../../domain/catalog";
import { availableAcross, isLowStock, stockReport } from "../../domain/inventory";
import { repriceBy } from "../../domain/pricing";
import { money } from "../../domain/money";

/** Admin catalogue management. */
export function adminCatalogRoutes(store: Store, search: SearchIndex, bus: EventBus): Router {
  const router = new Router();

  const reindex = (productId: string) => {
    const product = store.products.find(productId);
    if (!product) return;
    search.index(product, store.variants.byProduct(productId));
  };

  router.get("/products", (request: Request) => {
    const page = intQuery(request, "page", 1);
    const pageSize = intQuery(request, "pageSize", 50);
    const term = (request.query.q ?? "").toLowerCase();

    const matching = store.products.where(
      (product) =>
        !term ||
        product.title.toLowerCase().includes(term) ||
        product.handle.includes(term) ||
        product.tags.some((tag) => tag.toLowerCase().includes(term)),
    );

    return ok({
      products: matching.slice((page - 1) * pageSize, page * pageSize).map((product) => {
        const variants = store.variants.byProduct(product.id);
        return {
          id: product.id,
          handle: product.handle,
          title: product.title,
          status: product.status,
          vendor: product.vendor,
          variantCount: variants.length,
          totalStock: variants.reduce((n, v) => n + availableAcross(store.inventory.forVariant(v.id)), 0),
          updatedAt: product.updatedAt,
        };
      }),
      total: matching.length,
      page,
      pageSize,
    });
  });

  router.post("/products", (request: Request) => {
    const body = request.body as Record<string, unknown>;
    const title = field<string>(body, "title");
    const now = new Date().toISOString();

    const product: Product = {
      id: randomUUID(),
      handle: optionalField(body, "handle", slugify(title)),
      title,
      description: optionalField(body, "description", ""),
      vendor: optionalField(body, "vendor", ""),
      productType: optionalField(body, "productType", ""),
      status: optionalField(body, "status", "draft"),
      options: optionalField(body, "options", []),
      variantIds: [],
      imageIds: [],
      collectionIds: [],
      tags: optionalField(body, "tags", []),
      seoTitle: optionalField(body, "seoTitle", ""),
      seoDescription: optionalField(body, "seoDescription", ""),
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    store.products.insert(product);

    const combinations = optionCombinations(product.options);
    let position = 0;

    for (const combination of combinations) {
      const variant: Variant = {
        id: randomUUID(),
        productId: product.id,
        sku: `${product.handle}-${position + 1}`,
        barcode: null,
        optionValues: combination,
        price: money(optionalField(body, "price", 0)),
        compareAtPrice: null,
        costPrice: null,
        weightGrams: optionalField(body, "weightGrams", 0),
        lengthMm: 0,
        widthMm: 0,
        heightMm: 0,
        requiresShipping: optionalField(body, "requiresShipping", true),
        taxCode: optionalField(body, "taxCode", "standard"),
        imageIds: [],
        position: position++,
        active: true,
      };

      store.variants.insert(variant);
      product.variantIds.push(variant.id);
    }

    reindex(product.id);
    return created({ product, variants: store.variants.byProduct(product.id) });
  });

  router.get("/products/:id", (request: Request) => {
    const product = store.products.find(request.query.id);
    if (!product) throw notFound("Product");

    const variants = store.variants.byProduct(product.id);

    return ok({
      product,
      variants: variants.map((variant) => ({
        ...variant,
        stock: stockReport(variant, store.inventory.forVariant(variant.id)),
        marginPercent: marginPercent(variant),
      })),
    });
  });

  router.patch("/products/:id", (request: Request) => {
    const product = store.products.find(request.query.id);
    if (!product) throw notFound("Product");

    Object.assign(product, request.body as object);
    product.updatedAt = new Date().toISOString();
    reindex(product.id);

    return ok({ product });
  });

  router.post("/products/:id/publish", (request: Request) => {
    const product = store.products.find(request.query.id);
    if (!product) throw notFound("Product");

    product.status = "active";
    product.publishedAt = new Date().toISOString();
    reindex(product.id);

    bus.emit("product.published", { productId: product.id, handle: product.handle }, request.correlationId);
    return ok({ product });
  });

  router.post("/products/:id/unpublish", (request: Request) => {
    const product = store.products.find(request.query.id);
    if (!product) throw notFound("Product");

    product.status = "draft";
    product.publishedAt = null;
    search.remove(product.id);

    bus.emit("product.unpublished", { productId: product.id }, request.correlationId);
    return ok({ product });
  });

  router.delete("/products/:id", (request: Request) => {
    const product = store.products.find(request.query.id);
    if (!product) throw notFound("Product");

    for (const variantId of product.variantIds) {
      store.variants.remove(variantId);
    }
    store.products.remove(product.id);
    search.remove(product.id);

    return noContent();
  });

  router.post("/variants", (request: Request) => {
    const body = request.body as Record<string, unknown>;
    const productId = field<string>(body, "productId");
    const product = store.products.find(productId);
    if (!product) throw notFound("Product");

    const variant: Variant = {
      id: randomUUID(),
      productId,
      sku: field<string>(body, "sku"),
      barcode: optionalField(body, "barcode", null),
      optionValues: optionalField(body, "optionValues", []),
      price: field(body, "price"),
      compareAtPrice: optionalField(body, "compareAtPrice", null),
      costPrice: optionalField(body, "costPrice", null),
      weightGrams: optionalField(body, "weightGrams", 0),
      lengthMm: optionalField(body, "lengthMm", 0),
      widthMm: optionalField(body, "widthMm", 0),
      heightMm: optionalField(body, "heightMm", 0),
      requiresShipping: optionalField(body, "requiresShipping", true),
      taxCode: optionalField(body, "taxCode", "standard"),
      imageIds: [],
      position: product.variantIds.length,
      active: true,
    };

    store.variants.insert(variant);
    product.variantIds.push(variant.id);
    reindex(productId);

    return created({ variant });
  });

  router.patch("/variants/:id", (request: Request) => {
    const variant = store.variants.find(request.query.id);
    if (!variant) throw notFound("Variant");

    Object.assign(variant, request.body as object);
    reindex(variant.productId);

    return ok({ variant });
  });

  router.post("/variants/reprice", (request: Request) => {
    const percentChange = field<number>(request.body, "percentChange");
    const variantIds = optionalField<string[]>(request.body, "variantIds", []);

    const variants = variantIds.length
      ? variantIds.map((id) => store.variants.require(id))
      : store.variants.all();

    const newPrices = repriceBy(variants, percentChange);

    for (const [variantId, price] of newPrices) {
      store.variants.update(variantId, { price });
    }

    return ok({ updated: newPrices.size });
  });

  router.get("/inventory", (request: Request) => {
    const lowOnly = request.query.low === "true";

    const rows = store.variants.all().map((variant) => stockReport(variant, store.inventory.forVariant(variant.id)));
    return ok({ rows: lowOnly ? rows.filter((row) => row.belowReorderPoint) : rows });
  });

  router.post("/inventory/adjust", (request: Request) => {
    const variantId = field<string>(request.body, "variantId");
    const locationId = field<string>(request.body, "locationId");
    const delta = field<number>(request.body, "delta");

    const level = store.inventory.at(variantId, locationId) ?? {
      variantId,
      locationId,
      onHand: 0,
      committed: 0,
      incoming: 0,
      reorderPoint: 0,
      updatedAt: new Date().toISOString(),
    };

    level.onHand += delta;
    store.inventory.setLevel(level);

    store.inventory.recordMovement({
      id: randomUUID(),
      variantId,
      locationId,
      delta,
      reason: optionalField(request.body, "reason", "adjustment"),
      reference: optionalField(request.body, "reference", null),
      createdAt: new Date().toISOString(),
    });

    if (isLowStock(level)) {
      const variant = store.variants.find(variantId);
      bus.emit(
        "inventory.low",
        { variantId, sku: variant?.sku ?? "", available: level.onHand - level.committed },
        request.correlationId,
      );
    }

    return ok({ level });
  });

  router.post("/collections/:id/refresh", (request: Request) => {
    const collection = store.collections.find(request.query.id);
    if (!collection) throw notFound("Collection");
    if (collection.manual) throw badRequest("That collection is manual");

    collection.productIds = store.products
      .all()
      .filter((product) => matchesRules(product, store.variants.byProduct(product.id), collection.rules))
      .map((product) => product.id);

    return ok({ collection, count: collection.productIds.length });
  });

  return router;
}
