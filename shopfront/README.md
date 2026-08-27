# shopfront

Headless e-commerce platform: catalogue, cart, checkout, orders, payments,
fulfilment, returns, subscriptions, loyalty and reporting.

```ts
import { createApp } from "./src";

const app = createApp();

const response = await app.router.handle({
  method: "POST",
  path: "/api/storefront/carts",
  query: {},
  headers: {},
  body: { currency: "EUR", market: "NL" },
  ip: "127.0.0.1",
  actor: null,
  correlationId: "",
});
```

```
npm install
npm test        # type-checks with strict:true and runs 50 unit tests
```

## Layout

```
src/domain/          the business rules, no I/O
  money.ts           integer minor units, allocation, currency exponents
  catalog.ts         products, variants, options, collections, SEO
  inventory.ts       per-location levels, allocation, movements
  pricing.ts         price lists, quantity breaks, markdowns
  tax.ts             destination rates, inclusive/exclusive, reverse charge
  promotions.ts      conditions, effects, stacking, coupon codes
  shipping.ts        zones, weight/price bands, free-shipping thresholds
  cart.ts            lines, totals, validation, merge
  checkout.ts        the step machine and the commit
  order.ts           the immutable record and its derived statuses
  payment.ts         authorise / capture / refund / void
  fulfilment.ts      shipments, tracking, packing slips, pick lists
  returns.ts         RMA flow and refund calculation
  customer.ts        accounts, addresses, store credit, GDPR
  giftcards.ts       issue, redeem, expire, liability
  subscriptions.ts   contracts, cadence, dunning
  loyalty.ts         points, tiers, liability
  reviews.ts         moderation, verified purchases, ratings

src/store/           in-memory repositories behind the production interfaces
src/events/          typed domain event bus
src/webhooks/        signed outbound delivery + inbound verification
src/search/          inverted index, facets, suggestions, related products
src/api/             router, middleware, storefront and admin endpoints
src/integrations/    transactional email, bookkeeping export
src/analytics.ts     sales, cohorts, funnel, product and discount reports
src/jobs.ts          the scheduled work
```

## Money

Every amount is an integer count of minor units with its currency
attached. Cross-currency arithmetic throws rather than silently producing
a wrong total.

```ts
fromMajor(12.34, "EUR").amount   // 1234
fromMajor(500, "JPY").amount     // 500  (exponent 0)
allocate(money(100), 3)          // 34, 33, 33 - sums back to 100
```

## Cart and checkout

Totals are never stored: `computeTotals` recomputes from the lines every
time, so a price or promotion change is picked up on the next read. The
pipeline is lines → promotions → tax → shipping → gift cards → total.

Checkout is a four step session (contact, delivery, shipping, payment).
Committing reserves stock, authorises the card and, by default, captures
straight away.

## Promotions

Conditions cover minimum spend, minimum quantity, product and collection
scope, customer groups, market and first-order-only. Effects are
percentage, fixed amount, free shipping and buy-X-get-Y. Non-combinable
promotions are exclusive - the best one wins.

## Tax

Rates are looked up by country, region and product tax code, with
compounding for jurisdictions that stack (e.g. US state + county).
Tax-inclusive and tax-exclusive pricing are both supported, and intra-EU
B2B sales with a VAT id are reverse charged.

## Payments

`authorise` → `capture` → `refund`, with `void` for an authorisation that
will not be taken. `SandboxGateway` implements the interface in memory;
tokens ending `0002` always decline.

## Events and webhooks

Everything interesting emits a typed event. The dispatcher signs each
delivery (`x-shopfront-signature`), retries with exponential backoff, and
parks anything that never lands in a dead-letter list. Inbound webhooks
from Stripe, Mollie and Adyen each get a verifier plus replay protection.

## API

```
POST   /api/storefront/carts                       GET  /api/storefront/carts/:token
POST   /api/storefront/carts/:token/lines          PATCH/DELETE .../lines/:lineId
POST   /api/storefront/carts/:token/discounts      POST .../address, .../shipping-method
POST   /api/storefront/checkouts                   POST .../contact|delivery|shipping-method|payment
POST   /api/storefront/checkouts/:id/complete
GET    /api/storefront/products                    GET  /api/storefront/products/:handle
GET    /api/storefront/collections/:handle         GET  /api/storefront/search/suggest
POST   /api/storefront/account/register|login      GET  /api/storefront/account/orders

GET    /api/admin/orders                           GET  /api/admin/orders/:id
POST   /api/admin/orders/:id/cancel|capture|void|refunds|fulfilments
GET    /api/admin/products                         POST /api/admin/products
POST   /api/admin/inventory/adjust                 GET  /api/admin/inventory?low=true
GET    /api/admin/discounts                        POST /api/admin/discounts/:id/codes
GET    /api/admin/customers                        GET  /api/admin/customers/reports/cohorts
```

Middleware chain: error handling → correlation id → CORS → body limit →
authentication → rate limit → request log.

## Scheduled jobs

| Job | Cadence |
| --- | --- |
| `sweep-expired-carts` | nightly |
| `abandoned-cart-emails` | every 30 min |
| `check-low-stock` | daily |
| `settle-authorisations` | hourly |
| `refresh-collections` | nightly |
| `subscription-billing` | daily |
