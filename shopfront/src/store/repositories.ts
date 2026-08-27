import type { Product, Variant, Collection, ProductImage } from "../domain/catalog";
import type { InventoryLevel, Location, InventoryMovement, TrackedVariant } from "../domain/inventory";
import type { PriceList } from "../domain/pricing";
import type { Promotion } from "../domain/promotions";
import type { ShippingZone, ShippingMethod } from "../domain/shipping";
import type { TaxRate } from "../domain/tax";
import type { Cart } from "../domain/cart";
import type { Order } from "../domain/order";
import type { Transaction, PaymentMethod } from "../domain/payment";
import type { Fulfilment } from "../domain/fulfilment";
import type { ReturnRequest, Refund } from "../domain/returns";
import type { Customer, StoreCredit } from "../domain/customer";
import type { CheckoutSession } from "../domain/checkout";

/**
 * In-memory repositories.
 *
 * The production build swaps these for Postgres-backed implementations
 * behind the same interfaces.
 */

export interface Page<T> {
  items: T[];
  total: number;
  cursor: string | null;
}

export class Repository<T extends { id: string }> {
  protected items = new Map<string, T>();

  insert(item: T): T {
    this.items.set(item.id, item);
    return item;
  }

  insertMany(items: T[]): T[] {
    for (const item of items) this.insert(item);
    return items;
  }

  find(id: string): T | undefined {
    return this.items.get(id);
  }

  require(id: string): T {
    const item = this.items.get(id);
    if (!item) throw new Error(`no record ${id}`);
    return item;
  }

  update(id: string, patch: Partial<T>): T {
    const item = this.require(id);
    Object.assign(item, patch);
    return item;
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }

  all(): T[] {
    return [...this.items.values()];
  }

  where(predicate: (item: T) => boolean): T[] {
    return this.all().filter(predicate);
  }

  first(predicate: (item: T) => boolean): T | undefined {
    return this.all().find(predicate);
  }

  count(predicate?: (item: T) => boolean): number {
    return predicate ? this.where(predicate).length : this.items.size;
  }

  paginate(predicate: (item: T) => boolean, limit: number, offset: number): Page<T> {
    const matching = this.where(predicate);
    return {
      items: matching.slice(offset, offset + limit),
      total: matching.length,
      cursor: offset + limit < matching.length ? String(offset + limit) : null,
    };
  }

  clear(): void {
    this.items.clear();
  }
}

export class ProductRepository extends Repository<Product> {
  byHandle(handle: string): Product | undefined {
    return this.first((product) => product.handle === handle);
  }

  published(): Product[] {
    return this.where((product) => product.status === "active" && product.publishedAt !== null);
  }

  byCollection(collectionId: string): Product[] {
    return this.where((product) => product.collectionIds.includes(collectionId));
  }

  byTag(tag: string): Product[] {
    return this.where((product) => product.tags.includes(tag));
  }

  byVendor(vendor: string): Product[] {
    return this.where((product) => product.vendor === vendor);
  }

  vendors(): string[] {
    return [...new Set(this.all().map((product) => product.vendor))].sort();
  }

  productTypes(): string[] {
    return [...new Set(this.all().map((product) => product.productType))].sort();
  }
}

export class VariantRepository extends Repository<Variant> {
  bySku(sku: string): Variant | undefined {
    return this.first((variant) => variant.sku === sku);
  }

  byProduct(productId: string): Variant[] {
    return this.where((variant) => variant.productId === productId).sort((a, b) => a.position - b.position);
  }

  byBarcode(barcode: string): Variant | undefined {
    return this.first((variant) => variant.barcode === barcode);
  }

  asMap(): Map<string, Variant> {
    return new Map(this.all().map((variant) => [variant.id, variant]));
  }
}

export class InventoryRepository {
  private levels: InventoryLevel[] = [];
  private movements: InventoryMovement[] = [];
  private tracking = new Map<string, TrackedVariant>();

  setLevel(level: InventoryLevel): void {
    const index = this.levels.findIndex(
      (l) => l.variantId === level.variantId && l.locationId === level.locationId,
    );
    if (index === -1) {
      this.levels.push(level);
    } else {
      this.levels[index] = level;
    }
  }

  forVariant(variantId: string): InventoryLevel[] {
    return this.levels.filter((level) => level.variantId === variantId);
  }

  forLocation(locationId: string): InventoryLevel[] {
    return this.levels.filter((level) => level.locationId === locationId);
  }

  at(variantId: string, locationId: string): InventoryLevel | undefined {
    return this.levels.find((l) => l.variantId === variantId && l.locationId === locationId);
  }

  asMap(): Map<string, InventoryLevel[]> {
    const out = new Map<string, InventoryLevel[]>();
    for (const level of this.levels) {
      const list = out.get(level.variantId) ?? [];
      list.push(level);
      out.set(level.variantId, list);
    }
    return out;
  }

  recordMovement(movement: InventoryMovement): void {
    this.movements.push(movement);
  }

  movementsFor(variantId: string, limit = 50): InventoryMovement[] {
    return this.movements
      .filter((m) => m.variantId === variantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  setTracking(tracked: TrackedVariant): void {
    this.tracking.set(tracked.variantId, tracked);
  }

  trackingFor(variantId: string): TrackedVariant | undefined {
    return this.tracking.get(variantId);
  }

  trackingMap(): Map<string, TrackedVariant> {
    return new Map(this.tracking);
  }

  clear(): void {
    this.levels = [];
    this.movements = [];
    this.tracking.clear();
  }
}

export class OrderRepository extends Repository<Order> {
  byNumber(number: number): Order | undefined {
    return this.first((order) => order.number === number);
  }

  byCustomer(customerId: string): Order[] {
    return this.where((order) => order.customerId === customerId).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  byEmail(email: string): Order[] {
    return this.where((order) => order.email === email);
  }

  open(): Order[] {
    return this.where((order) => order.status === "open");
  }

  awaitingFulfilment(): Order[] {
    return this.where(
      (order) => order.status === "open" && order.fulfilmentStatus !== "fulfilled",
    );
  }

  between(from: string, to: string): Order[] {
    return this.where((order) => order.createdAt >= from && order.createdAt <= to);
  }
}

export class CustomerRepository extends Repository<Customer> {
  byEmail(email: string): Customer | undefined {
    return this.first((customer) => customer.email === email.trim().toLowerCase());
  }

  inGroup(group: string): Customer[] {
    return this.where((customer) => customer.groups.includes(group));
  }

  marketingSubscribers(): Customer[] {
    return this.where((customer) => customer.acceptsEmailMarketing && customer.state !== "disabled");
  }
}

export class TransactionRepository extends Repository<Transaction> {
  forOrder(orderId: string): Transaction[] {
    return this.where((tx) => tx.orderId === orderId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  byReference(reference: string): Transaction | undefined {
    return this.first((tx) => tx.gatewayReference === reference);
  }

  successful(): Transaction[] {
    return this.where((tx) => tx.status === "success");
  }
}

export class FulfilmentRepository extends Repository<Fulfilment> {
  forOrder(orderId: string): Fulfilment[] {
    return this.where((f) => f.orderId === orderId);
  }

  pending(): Fulfilment[] {
    return this.where((f) => f.state === "pending");
  }

  byTracking(trackingNumber: string): Fulfilment | undefined {
    return this.first((f) => f.trackingNumber === trackingNumber);
  }
}

export class ReturnRepository extends Repository<ReturnRequest> {
  forOrder(orderId: string): ReturnRequest[] {
    return this.where((r) => r.orderId === orderId);
  }

  open(): ReturnRequest[] {
    return this.where((r) => r.state !== "closed" && r.state !== "declined");
  }
}

export class CartRepository extends Repository<Cart> {
  byToken(token: string): Cart | undefined {
    return this.first((cart) => cart.token === token);
  }

  forCustomer(customerId: string): Cart[] {
    return this.where((cart) => cart.customerId === customerId);
  }

  expired(now: string): Cart[] {
    return this.where((cart) => cart.expiresAt < now);
  }
}

/** Everything wired together, so a request handler takes one object. */
export interface Store {
  products: ProductRepository;
  variants: VariantRepository;
  collections: Repository<Collection>;
  images: Repository<ProductImage>;
  inventory: InventoryRepository;
  locations: Repository<Location>;
  priceLists: Repository<PriceList>;
  promotions: Repository<Promotion>;
  zones: Repository<ShippingZone>;
  shippingMethods: Repository<ShippingMethod>;
  taxRates: Repository<TaxRate & { id: string }>;
  carts: CartRepository;
  checkouts: Repository<CheckoutSession>;
  orders: OrderRepository;
  transactions: TransactionRepository;
  paymentMethods: Repository<PaymentMethod>;
  fulfilments: FulfilmentRepository;
  returns: ReturnRepository;
  refunds: Repository<Refund>;
  customers: CustomerRepository;
  storeCredit: Repository<StoreCredit>;
}

export function createStore(): Store {
  return {
    products: new ProductRepository(),
    variants: new VariantRepository(),
    collections: new Repository<Collection>(),
    images: new Repository<ProductImage>(),
    inventory: new InventoryRepository(),
    locations: new Repository<Location>(),
    priceLists: new Repository<PriceList>(),
    promotions: new Repository<Promotion>(),
    zones: new Repository<ShippingZone>(),
    shippingMethods: new Repository<ShippingMethod>(),
    taxRates: new Repository<TaxRate & { id: string }>(),
    carts: new CartRepository(),
    checkouts: new Repository<CheckoutSession>(),
    orders: new OrderRepository(),
    transactions: new TransactionRepository(),
    paymentMethods: new Repository<PaymentMethod>(),
    fulfilments: new FulfilmentRepository(),
    returns: new ReturnRepository(),
    refunds: new Repository<Refund>(),
    customers: new CustomerRepository(),
    storeCredit: new Repository<StoreCredit>(),
  };
}
