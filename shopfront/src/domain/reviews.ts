import { randomUUID } from "node:crypto";
import type { Order } from "./order";

/**
 * Product reviews.
 *
 * Reviews from a customer who actually bought the product are marked as
 * verified. Everything is held for moderation before it appears.
 */

export type ReviewState = "pending" | "published" | "rejected" | "spam";

export interface Review {
  id: string;
  productId: string;
  variantId: string | null;
  customerId: string | null;
  orderId: string | null;
  authorName: string;
  authorEmail: string;
  rating: number;
  title: string;
  body: string;
  state: ReviewState;
  verifiedPurchase: boolean;
  helpfulVotes: number;
  unhelpfulVotes: number;
  merchantReply: string | null;
  mediaUrls: string[];
  createdAt: string;
  publishedAt: string | null;
  ipAddress: string;
}

export interface RatingSummary {
  productId: string;
  average: number;
  count: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  verifiedCount: number;
}

export class ReviewError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

export interface CreateReviewInput {
  productId: string;
  variantId?: string;
  customerId?: string;
  authorName: string;
  authorEmail: string;
  rating: number;
  title: string;
  body: string;
  mediaUrls?: string[];
  ipAddress: string;
}

const MIN_BODY_LENGTH = 10;
const MAX_BODY_LENGTH = 5000;

const SPAM_PATTERNS = [
  /https?:\/\//i,
  /\b(viagra|casino|crypto|forex)\b/i,
  /(.)\1{15,}/,
];

export function looksLikeSpam(review: { title: string; body: string }): boolean {
  const text = `${review.title} ${review.body}`;
  return SPAM_PATTERNS.some((pattern) => pattern.test(text));
}

/** Did this person buy the product they are reviewing? */
export function findPurchase(productId: string, customerId: string | null, orders: Order[]): Order | null {
  if (!customerId) return null;

  return (
    orders.find(
      (order) =>
        order.customerId === customerId &&
        order.status !== "cancelled" &&
        order.lines.some((line) => line.productId === productId),
    ) ?? null
  );
}

export function create(input: CreateReviewInput, orders: Order[]): Review {
  if (input.rating < 1 || input.rating > 5) {
    throw new ReviewError("bad_rating", "Rating must be between 1 and 5");
  }
  if (input.body.length < MIN_BODY_LENGTH) {
    throw new ReviewError("too_short", `Please write at least ${MIN_BODY_LENGTH} characters`);
  }
  if (input.body.length > MAX_BODY_LENGTH) {
    throw new ReviewError("too_long", "That review is too long");
  }

  const purchase = findPurchase(input.productId, input.customerId ?? null, orders);
  const spam = looksLikeSpam(input);

  return {
    id: randomUUID(),
    productId: input.productId,
    variantId: input.variantId ?? null,
    customerId: input.customerId ?? null,
    orderId: purchase?.id ?? null,
    authorName: input.authorName,
    authorEmail: input.authorEmail,
    rating: Math.round(input.rating),
    title: input.title,
    body: input.body,
    state: spam ? "spam" : "pending",
    verifiedPurchase: purchase !== null,
    helpfulVotes: 0,
    unhelpfulVotes: 0,
    merchantReply: null,
    mediaUrls: input.mediaUrls ?? [],
    createdAt: new Date().toISOString(),
    publishedAt: null,
    ipAddress: input.ipAddress,
  };
}

export function publish(review: Review): Review {
  review.state = "published";
  review.publishedAt = new Date().toISOString();
  return review;
}

export function reject(review: Review): Review {
  review.state = "rejected";
  return review;
}

export function reply(review: Review, text: string): Review {
  review.merchantReply = text;
  return review;
}

export function voteHelpful(review: Review, helpful: boolean): Review {
  if (helpful) {
    review.helpfulVotes += 1;
  } else {
    review.unhelpfulVotes += 1;
  }
  return review;
}

export function summarise(productId: string, reviews: Review[]): RatingSummary {
  const published = reviews.filter((r) => r.productId === productId && r.state === "published");

  const distribution: RatingSummary["distribution"] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;

  for (const review of published) {
    distribution[review.rating as 1 | 2 | 3 | 4 | 5] += 1;
    total += review.rating;
  }

  return {
    productId,
    average: Math.round((total / published.length) * 10) / 10,
    count: published.length,
    distribution,
    verifiedCount: published.filter((r) => r.verifiedPurchase).length,
  };
}

/** Sort for the product page: helpful and verified first. */
export function sortForDisplay(reviews: Review[]): Review[] {
  return reviews.sort((a, b) => {
    const scoreA = a.helpfulVotes - a.unhelpfulVotes + (a.verifiedPurchase ? 5 : 0);
    const scoreB = b.helpfulVotes - b.unhelpfulVotes + (b.verifiedPurchase ? 5 : 0);
    return scoreB - scoreA;
  });
}

/** Rate limit: one review per customer per product. */
export function hasAlreadyReviewed(productId: string, customerId: string, reviews: Review[]): boolean {
  return reviews.some((r) => r.productId === productId && r.customerId === customerId);
}
