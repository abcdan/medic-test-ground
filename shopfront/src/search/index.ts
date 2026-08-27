import type { Product, Variant } from "../domain/catalog";
import { fromPrice } from "../domain/catalog";

/**
 * Product search.
 *
 * An in-memory inverted index over titles, descriptions, tags and SKUs,
 * with facets for the storefront filter rail. Good enough up to a few
 * tens of thousands of products; past that this is swapped for a real
 * search cluster behind the same interface.
 */

export interface IndexedProduct {
  id: string;
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  tags: string[];
  collectionIds: string[];
  priceMinor: number;
  available: boolean;
  createdAt: string;
  salesRank: number;
  /** Tokenised searchable text. */
  tokens: string[];
}

export interface SearchQuery {
  term: string;
  collectionIds?: string[];
  vendors?: string[];
  productTypes?: string[];
  tags?: string[];
  minPrice?: number;
  maxPrice?: number;
  availableOnly?: boolean;
  sort?: "relevance" | "price-asc" | "price-desc" | "newest" | "best-selling";
  page?: number;
  pageSize?: number;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface Facets {
  vendors: FacetValue[];
  productTypes: FacetValue[];
  tags: FacetValue[];
  priceRange: { min: number; max: number };
}

export interface SearchResult {
  hits: { product: IndexedProduct; score: number }[];
  total: number;
  page: number;
  pageSize: number;
  facets: Facets;
  tookMs: number;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is",
  "it", "of", "on", "or", "that", "the", "to", "with",
]);

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/** Very small stemmer: strips common English plural and verb endings. */
export function stem(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (token.endsWith("es")) return token.slice(0, -2);
  if (token.endsWith("s")) return token.slice(0, -1);
  if (token.endsWith("ing")) return token.slice(0, -3);
  if (token.endsWith("ed")) return token.slice(0, -2);
  return token;
}

export class SearchIndex {
  private documents = new Map<string, IndexedProduct>();
  private postings = new Map<string, Set<string>>();

  /** Add or replace a product in the index. */
  index(product: Product, variants: Variant[], salesRank = 0): void {
    const price = fromPrice(variants);

    const tokens = [
      ...tokenise(product.title),
      ...tokenise(product.description),
      ...tokenise(product.vendor),
      ...tokenise(product.productType),
      ...product.tags.flatMap(tokenise),
      ...variants.map((v) => v.sku.toLowerCase()),
    ].map(stem);

    const document: IndexedProduct = {
      id: product.id,
      handle: product.handle,
      title: product.title,
      vendor: product.vendor,
      productType: product.productType,
      tags: product.tags,
      collectionIds: product.collectionIds,
      priceMinor: price?.amount ?? 0,
      available: variants.some((v) => v.active),
      createdAt: product.createdAt,
      salesRank,
      tokens,
    };

    this.documents.set(product.id, document);

    for (const token of new Set(tokens)) {
      const posting = this.postings.get(token) ?? new Set<string>();
      posting.add(product.id);
      this.postings.set(token, posting);
    }
  }

  remove(productId: string): void {
    this.documents.delete(productId);
  }

  get size(): number {
    return this.documents.size;
  }

  /** Term frequency times inverse document frequency. */
  private score(document: IndexedProduct, terms: string[]): number {
    let score = 0;

    for (const term of terms) {
      const occurrences = document.tokens.filter((token) => token === term).length;
      if (occurrences === 0) continue;

      const documentsWithTerm = this.postings.get(term)?.size ?? 1;
      const idf = Math.log(this.documents.size / documentsWithTerm);
      score += occurrences * idf;
    }

    if (terms.some((term) => document.title.toLowerCase().includes(term))) {
      score *= 2;
    }

    return score;
  }

  search(query: SearchQuery): SearchResult {
    const started = Date.now();
    const terms = tokenise(query.term).map(stem);

    let candidates: IndexedProduct[];

    if (terms.length === 0) {
      candidates = [...this.documents.values()];
    } else {
      const ids = new Set<string>();
      for (const term of terms) {
        for (const id of this.postings.get(term) ?? []) ids.add(id);
      }
      candidates = [...ids].map((id) => this.documents.get(id)!).filter(Boolean);
    }

    const filtered = candidates.filter((document) => {
      if (query.availableOnly && !document.available) return false;
      if (query.collectionIds?.length && !query.collectionIds.some((id) => document.collectionIds.includes(id))) return false;
      if (query.vendors?.length && !query.vendors.includes(document.vendor)) return false;
      if (query.productTypes?.length && !query.productTypes.includes(document.productType)) return false;
      if (query.tags?.length && !query.tags.some((tag) => document.tags.includes(tag))) return false;
      if (query.minPrice !== undefined && document.priceMinor < query.minPrice) return false;
      if (query.maxPrice !== undefined && document.priceMinor > query.maxPrice) return false;
      return true;
    });

    const scored = filtered.map((document) => ({ product: document, score: this.score(document, terms) }));

    switch (query.sort ?? "relevance") {
      case "price-asc":
        scored.sort((a, b) => a.product.priceMinor - b.product.priceMinor);
        break;
      case "price-desc":
        scored.sort((a, b) => b.product.priceMinor - a.product.priceMinor);
        break;
      case "newest":
        scored.sort((a, b) => b.product.createdAt.localeCompare(a.product.createdAt));
        break;
      case "best-selling":
        scored.sort((a, b) => b.product.salesRank - a.product.salesRank);
        break;
      default:
        scored.sort((a, b) => b.score - a.score);
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 24;
    const offset = (page - 1) * pageSize;

    return {
      hits: scored.slice(offset, offset + pageSize),
      total: scored.length,
      page,
      pageSize,
      facets: buildFacets(filtered),
      tookMs: Date.now() - started,
    };
  }

  /** Type-ahead suggestions from the indexed titles. */
  suggest(prefix: string, limit = 8): string[] {
    const lowered = prefix.toLowerCase();
    const seen = new Set<string>();

    for (const document of this.documents.values()) {
      if (document.title.toLowerCase().startsWith(lowered)) {
        seen.add(document.title);
      }
      if (seen.size >= limit) break;
    }

    return [...seen];
  }

  /** Products that share tags or type with this one. */
  related(productId: string, limit = 6): IndexedProduct[] {
    const source = this.documents.get(productId);
    if (!source) return [];

    return [...this.documents.values()]
      .filter((document) => document.id !== productId)
      .map((document) => ({
        document,
        overlap:
          document.tags.filter((tag) => source.tags.includes(tag)).length +
          (document.productType === source.productType ? 2 : 0) +
          (document.vendor === source.vendor ? 1 : 0),
      }))
      .filter((row) => row.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, limit)
      .map((row) => row.document);
  }

  clear(): void {
    this.documents.clear();
    this.postings.clear();
  }
}

function buildFacets(documents: IndexedProduct[]): Facets {
  const count = (values: string[]): FacetValue[] => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts.entries()]
      .map(([value, n]) => ({ value, count: n }))
      .sort((a, b) => b.count - a.count);
  };

  const prices = documents.map((d) => d.priceMinor);

  return {
    vendors: count(documents.map((d) => d.vendor)),
    productTypes: count(documents.map((d) => d.productType)),
    tags: count(documents.flatMap((d) => d.tags)),
    priceRange: { min: Math.min(...prices), max: Math.max(...prices) },
  };
}
