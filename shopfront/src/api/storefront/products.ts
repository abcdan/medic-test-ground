import { Router } from "../router";
import { intQuery, notFound, ok, type Request } from "../middleware";
import type { Store } from "../../store/repositories";
import type { SearchIndex } from "../../search";
import { discountPercent, fromPrice, isOnSale, seoFor, variantTitle } from "../../domain/catalog";
import { availableAcross } from "../../domain/inventory";
import { format } from "../../domain/money";
import { summarise as summariseReviews } from "../../domain/reviews";
import type { Review } from "../../domain/reviews";

/** Public product browsing. */
export function productRoutes(store: Store, search: SearchIndex, reviews: Review[], baseUrl: string): Router {
  const router = new Router();

  const serialiseVariant = (variantId: string) => {
    const variant = store.variants.require(variantId);
    const levels = store.inventory.forVariant(variant.id);

    return {
      id: variant.id,
      sku: variant.sku,
      title: variantTitle(variant),
      options: variant.optionValues,
      price: variant.price,
      priceFormatted: format(variant.price),
      compareAtPrice: variant.compareAtPrice,
      onSale: isOnSale(variant),
      discountPercent: discountPercent(variant),
      available: availableAcross(levels) > 0,
      availableQuantity: availableAcross(levels),
      requiresShipping: variant.requiresShipping,
      weightGrams: variant.weightGrams,
      costPrice: variant.costPrice,
    };
  };

  const serialiseProduct = (productId: string) => {
    const product = store.products.require(productId);
    const variants = store.variants.byProduct(product.id);
    const rating = summariseReviews(product.id, reviews);

    return {
      id: product.id,
      handle: product.handle,
      title: product.title,
      description: product.description,
      vendor: product.vendor,
      productType: product.productType,
      tags: product.tags,
      options: product.options,
      images: product.imageIds.map((id) => store.images.find(id)).filter(Boolean),
      variants: variants.map((variant) => serialiseVariant(variant.id)),
      fromPrice: fromPrice(variants),
      rating: { average: rating.average, count: rating.count },
      seo: seoFor(product, baseUrl),
      publishedAt: product.publishedAt,
    };
  };

  router.get("/products", (request: Request) => {
    const result = search.search({
      term: request.query.q ?? "",
      collectionIds: request.query.collection ? [request.query.collection] : undefined,
      vendors: request.query.vendor ? request.query.vendor.split(",") : undefined,
      productTypes: request.query.type ? request.query.type.split(",") : undefined,
      tags: request.query.tag ? request.query.tag.split(",") : undefined,
      minPrice: request.query.minPrice ? Number(request.query.minPrice) : undefined,
      maxPrice: request.query.maxPrice ? Number(request.query.maxPrice) : undefined,
      availableOnly: request.query.available === "true",
      sort: (request.query.sort as never) ?? "relevance",
      page: intQuery(request, "page", 1),
      pageSize: intQuery(request, "pageSize", 24),
    });

    return ok({
      products: result.hits.map((hit) => serialiseProduct(hit.product.id)),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      facets: result.facets,
      tookMs: result.tookMs,
    });
  });

  router.get("/products/:handle", (request: Request) => {
    const product = store.products.byHandle(request.query.handle);
    if (!product) throw notFound(`Product ${request.query.handle}`);

    return ok({
      product: serialiseProduct(product.id),
      related: search.related(product.id).map((hit) => serialiseProduct(hit.id)),
    });
  });

  router.get("/products/:handle/reviews", (request: Request) => {
    const product = store.products.byHandle(request.query.handle);
    if (!product) throw notFound(`Product ${request.query.handle}`);

    const published = reviews.filter((r) => r.productId === product.id && r.state === "published");

    return ok({
      reviews: published.map((review) => ({
        id: review.id,
        authorName: review.authorName,
        authorEmail: review.authorEmail,
        rating: review.rating,
        title: review.title,
        body: review.body,
        verifiedPurchase: review.verifiedPurchase,
        helpfulVotes: review.helpfulVotes,
        merchantReply: review.merchantReply,
        createdAt: review.createdAt,
      })),
      summary: summariseReviews(product.id, reviews),
    });
  });

  router.get("/collections", () =>
    ok({
      collections: store.collections
        .where((collection) => collection.publishedAt !== null)
        .map((collection) => ({
          id: collection.id,
          handle: collection.handle,
          title: collection.title,
          description: collection.description,
          productCount: collection.productIds.length,
        })),
    }),
  );

  router.get("/collections/:handle", (request: Request) => {
    const collection = store.collections.first((c) => c.handle === request.query.handle);
    if (!collection) throw notFound(`Collection ${request.query.handle}`);

    const page = intQuery(request, "page", 1);
    const pageSize = intQuery(request, "pageSize", 24);
    const offset = (page - 1) * pageSize;

    const products = store.products.byCollection(collection.id);

    return ok({
      collection: {
        id: collection.id,
        handle: collection.handle,
        title: collection.title,
        description: collection.description,
      },
      products: products.slice(offset, offset + pageSize).map((product) => serialiseProduct(product.id)),
      total: products.length,
      page,
      pageSize,
    });
  });

  router.get("/search/suggest", (request: Request) =>
    ok({ suggestions: search.suggest(request.query.q ?? "", intQuery(request, "limit", 8)) }),
  );

  router.get("/filters", () =>
    ok({
      vendors: store.products.vendors(),
      productTypes: store.products.productTypes(),
      tags: [...new Set(store.products.all().flatMap((p) => p.tags))].sort(),
    }),
  );

  return router;
}
