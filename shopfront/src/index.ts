import { Router } from "./api/router";
import {
  authenticate,
  bodyLimit,
  cors,
  correlate,
  errorHandler,
  rateLimit,
  requestLog,
  requireScope,
  type Actor,
  type ApiKey,
} from "./api/middleware";
import { createStore, type Store } from "./store/repositories";
import { EventBus } from "./events/bus";
import { SearchIndex } from "./search";
import { SandboxGateway, type Gateway } from "./domain/payment";
import { productRoutes } from "./api/storefront/products";
import { cartRoutes } from "./api/storefront/cart";
import { checkoutRoutes } from "./api/storefront/checkout";
import { accountRoutes } from "./api/storefront/account";
import { adminOrderRoutes } from "./api/admin/orders";
import { adminCatalogRoutes } from "./api/admin/catalog";
import { adminDiscountRoutes } from "./api/admin/discounts";
import { adminCustomerRoutes } from "./api/admin/customers";
import { WebhookDispatcher, FetchTransport } from "./webhooks/dispatcher";
import { WebhookReceiver } from "./webhooks/receiver";
import { EmailQueue, MemoryEmailProvider, type EmailSettings } from "./integrations/email";
import { DEFAULT_RATES } from "./domain/tax";
import { DEFAULT_ZONES } from "./domain/shipping";
import type { Review } from "./domain/reviews";

/**
 * Each domain is re-exported under its own namespace: several of them
 * define a `create`, a `cancel` and a `summarise`, and namespacing keeps
 * call sites honest about which one they mean.
 */
export * as Money from "./domain/money";
export * as Catalog from "./domain/catalog";
export * as Inventory from "./domain/inventory";
export * as Pricing from "./domain/pricing";
export * as Tax from "./domain/tax";
export * as Promotions from "./domain/promotions";
export * as Shipping from "./domain/shipping";
export * as Carts from "./domain/cart";
export * as Orders from "./domain/order";
export * as Payments from "./domain/payment";
export * as Fulfilments from "./domain/fulfilment";
export * as Returns from "./domain/returns";
export * as Customers from "./domain/customer";
export * as Checkout from "./domain/checkout";
export * as GiftCards from "./domain/giftcards";
export * as Subscriptions from "./domain/subscriptions";
export * as Reviews from "./domain/reviews";
export * as Loyalty from "./domain/loyalty";
export * as Accounting from "./integrations/accounting";
export * as Email from "./integrations/email";
export * as Search from "./search";
export * as Analytics from "./analytics";
export * as Jobs from "./jobs";
export { createStore } from "./store/repositories";
export { EventBus, bus } from "./events/bus";
export { Router } from "./api/router";

export interface AppConfig {
  shopName: string;
  shopUrl: string;
  baseUrl: string;
  allowedOrigins: string[];
  apiKeys: ApiKey[];
  emailSettings: EmailSettings;
  webhookSecrets: Record<string, string>;
  rateLimit: { requests: number; windowMs: number };
  maxBodyBytes: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  shopName: "Shopfront",
  shopUrl: "https://example.test",
  baseUrl: "https://example.test",
  allowedOrigins: ["*"],
  apiKeys: [],
  emailSettings: {
    fromAddress: "orders@example.test",
    fromName: "Shopfront",
    replyTo: null,
    shopName: "Shopfront",
    shopUrl: "https://example.test",
    supportEmail: "support@example.test",
    logoUrl: null,
  },
  webhookSecrets: {},
  rateLimit: { requests: 300, windowMs: 60_000 },
  maxBodyBytes: 1_000_000,
};

export interface App {
  router: Router;
  store: Store;
  bus: EventBus;
  search: SearchIndex;
  gateway: Gateway;
  dispatcher: WebhookDispatcher;
  receiver: WebhookReceiver;
  emails: EmailQueue;
  sessions: Map<string, Actor>;
  reviews: Review[];
  config: AppConfig;
}

/** Wire everything together. */
export function createApp(config: AppConfig = DEFAULT_CONFIG, gateway: Gateway = new SandboxGateway()): App {
  const store = createStore();
  const bus = new EventBus();
  const search = new SearchIndex();
  const sessions = new Map<string, Actor>();
  const reviews: Review[] = [];

  const dispatcher = new WebhookDispatcher(new FetchTransport());
  const receiver = new WebhookReceiver(config.webhookSecrets);
  const emails = new EmailQueue(new MemoryEmailProvider());

  store.taxRates.insertMany(DEFAULT_RATES);
  store.zones.insertMany(DEFAULT_ZONES);

  bus.onAny((envelope) => {
    dispatcher.enqueue(envelope);
  });

  const router = new Router();

  router
    .use(errorHandler)
    .use(correlate)
    .use(cors(config.allowedOrigins))
    .use(bodyLimit(config.maxBodyBytes))
    .use(authenticate(config.apiKeys, sessions))
    .use(rateLimit(config.rateLimit.requests, config.rateLimit.windowMs))
    .use(requestLog);

  router.mount("/api/storefront", productRoutes(store, search, reviews, config.baseUrl));
  router.mount("/api/storefront", cartRoutes(store, bus));
  router.mount("/api/storefront", checkoutRoutes(store, bus, gateway));
  router.mount("/api/storefront", accountRoutes(store, bus, sessions));

  const admin = new Router();
  admin.use(requireScope("admin"));
  admin.mount("", adminOrderRoutes(store, bus, gateway));
  admin.mount("", adminCatalogRoutes(store, search, bus));
  admin.mount("", adminDiscountRoutes(store));
  admin.mount("", adminCustomerRoutes(store, bus));
  router.mount("/api/admin", admin);

  router.get("/health", () => ({
    status: 200,
    headers: { "content-type": "application/json" },
    body: {
      ok: true,
      products: store.products.count(),
      orders: store.orders.count(),
      carts: store.carts.count(),
      indexed: search.size,
      pendingWebhooks: dispatcher.pending().length,
    },
  }));

  router.get("/_routes", () => ({
    status: 200,
    headers: { "content-type": "application/json" },
    body: { routes: router.list() },
  }));

  return { router, store, bus, search, gateway, dispatcher, receiver, emails, sessions, reviews, config };
}
