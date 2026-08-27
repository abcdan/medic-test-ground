import { Router } from "../router";
import { badRequest, created, field, intQuery, notFound, ok, optionalField, type Request } from "../middleware";
import type { Store } from "../../store/repositories";
import type { EventBus } from "../../events/bus";
import type { Gateway } from "../../domain/payment";
import { capture, netPaid, refund as refundPayment, voidAuthorisation } from "../../domain/payment";
import { cancel as cancelOrder, matchesFilter, metrics, recomputeStatuses, summarise } from "../../domain/order";
import { addTracking, create as createFulfilment, markDelivered, packingSlip, pickList } from "../../domain/fulfilment";
import {
  applyRefund,
  approve,
  calculateRefund,
  goodwillRefund,
  receive,
  returnsByReason,
} from "../../domain/returns";
import { restock } from "../../domain/inventory";
import { format } from "../../domain/money";

/** Admin order management. */
export function adminOrderRoutes(store: Store, bus: EventBus, gateway: Gateway): Router {
  const router = new Router();

  const load = (id: string) => {
    const order = store.orders.find(id);
    if (!order) throw notFound("Order");
    return order;
  };

  router.get("/orders", (request: Request) => {
    const page = intQuery(request, "page", 1);
    const pageSize = intQuery(request, "pageSize", 50);

    const filtered = store.orders.where((order) =>
      matchesFilter(order, {
        status: request.query.status as never,
        paymentStatus: request.query.paymentStatus as never,
        fulfilmentStatus: request.query.fulfilmentStatus as never,
        customerId: request.query.customerId,
        email: request.query.email,
        createdAfter: request.query.createdAfter,
        createdBefore: request.query.createdBefore,
        search: request.query.q,
      }),
    );

    const sorted = filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return ok({
      orders: sorted.slice((page - 1) * pageSize, page * pageSize).map((order) => ({
        id: order.id,
        name: order.name,
        email: order.email,
        createdAt: order.createdAt,
        status: order.status,
        paymentStatus: order.paymentStatus,
        fulfilmentStatus: order.fulfilmentStatus,
        total: order.total,
        totalFormatted: format(order.total),
        summary: summarise(order),
      })),
      total: filtered.length,
      page,
      pageSize,
    });
  });

  router.get("/orders/:id", (request: Request) => {
    const order = load(request.query.id);

    return ok({
      order,
      transactions: store.transactions.forOrder(order.id),
      fulfilments: store.fulfilments.forOrder(order.id),
      returns: store.returns.forOrder(order.id),
      netPaid: netPaid(store.transactions.forOrder(order.id), order.currency),
      customer: order.customerId ? store.customers.find(order.customerId) : null,
    });
  });

  router.patch("/orders/:id", (request: Request) => {
    const order = load(request.query.id);
    const patch = request.body as Record<string, unknown>;

    Object.assign(order, patch);
    order.updatedAt = new Date().toISOString();

    bus.emit("order.updated", { order, changed: Object.keys(patch) }, request.correlationId);
    return ok({ order });
  });

  router.post("/orders/:id/cancel", async (request: Request) => {
    const order = load(request.query.id);
    const shouldRestock = optionalField(request.body, "restock", true);
    const shouldRefund = optionalField(request.body, "refund", true);

    cancelOrder(order, {
      reason: optionalField(request.body, "reason", "other"),
      restock: shouldRestock,
      refund: shouldRefund,
    });

    if (shouldRestock) {
      for (const line of order.lines) {
        const levels = store.inventory.forVariant(line.variantId);
        if (levels[0]) store.inventory.setLevel(restock(levels[0], line.quantity));
      }
    }

    if (shouldRefund && order.paidTotal.amount > 0) {
      const transactions = store.transactions.forOrder(order.id);
      const captureTx = transactions.find((t) => t.kind === "capture" && t.status === "success");

      if (captureTx) {
        const tx = await refundPayment(order, captureTx, gateway, order.paidTotal, transactions);
        store.transactions.insert(tx);
        order.refundedTotal = tx.amount;
      }
    }

    recomputeStatuses(order);
    bus.emit("order.cancelled", { order, reason: order.cancelReason ?? "" }, request.correlationId);

    return ok({ order });
  });

  router.post("/orders/:id/capture", async (request: Request) => {
    const order = load(request.query.id);
    const transactions = store.transactions.forOrder(order.id);
    const authorisation = transactions.find((t) => t.kind === "authorisation" && t.status === "success");

    if (!authorisation) throw badRequest("There is nothing to capture on this order");

    const tx = await capture(order, authorisation, gateway);
    store.transactions.insert(tx);

    order.paidTotal = tx.amount;
    recomputeStatuses(order);
    bus.emit("payment.captured", { transaction: tx }, request.correlationId);

    return ok({ transaction: tx, order });
  });

  router.post("/orders/:id/void", async (request: Request) => {
    const order = load(request.query.id);
    const authorisation = store.transactions
      .forOrder(order.id)
      .find((t) => t.kind === "authorisation" && t.status === "success");

    if (!authorisation) throw badRequest("There is nothing to void");

    const tx = await voidAuthorisation(order, authorisation, gateway);
    store.transactions.insert(tx);
    order.paymentStatus = "voided";

    return ok({ transaction: tx });
  });

  router.post("/orders/:id/refunds", async (request: Request) => {
    const order = load(request.query.id);
    const amount = field<{ amount: number; currency: string }>(request.body, "amount");
    const reason = optionalField(request.body, "reason", "requested_by_customer");

    const refundRecord = goodwillRefund(order, amount, reason, request.actor?.id ?? "system");
    store.refunds.insert(refundRecord);

    const transactions = store.transactions.forOrder(order.id);
    const captureTx = transactions.find((t) => t.kind === "capture" && t.status === "success");

    if (captureTx) {
      const tx = await refundPayment(order, captureTx, gateway, amount, transactions);
      store.transactions.insert(tx);
    }

    applyRefund(order, refundRecord);
    recomputeStatuses(order);
    bus.emit("refund.created", { refund: refundRecord }, request.correlationId);

    return created({ refund: refundRecord });
  });

  router.post("/orders/:id/fulfilments", (request: Request) => {
    const order = load(request.query.id);

    const fulfilment = createFulfilment(order, {
      locationId: field<string>(request.body, "locationId"),
      lines: field(request.body, "lines"),
      carrier: optionalField(request.body, "carrier", undefined),
      trackingNumber: optionalField(request.body, "trackingNumber", undefined),
      notifyCustomer: optionalField(request.body, "notifyCustomer", true),
    });

    store.fulfilments.insert(fulfilment);
    recomputeStatuses(order);

    bus.emit("fulfilment.created", { fulfilment }, request.correlationId);
    bus.emit(
      order.fulfilmentStatus === "fulfilled" ? "order.fulfilled" : "order.partially_fulfilled",
      { order, fulfilment },
      request.correlationId,
    );

    return created({ fulfilment, order });
  });

  router.post("/fulfilments/:id/tracking", (request: Request) => {
    const fulfilment = store.fulfilments.find(request.query.id);
    if (!fulfilment) throw notFound("Fulfilment");

    addTracking(fulfilment, field<string>(request.body, "carrier"), field<string>(request.body, "trackingNumber"));
    return ok({ fulfilment });
  });

  router.post("/fulfilments/:id/delivered", (request: Request) => {
    const fulfilment = store.fulfilments.find(request.query.id);
    if (!fulfilment) throw notFound("Fulfilment");

    markDelivered(fulfilment);
    bus.emit("fulfilment.delivered", { fulfilment }, request.correlationId);
    return ok({ fulfilment });
  });

  router.get("/fulfilments/pick-list", () => {
    const orders = new Map(store.orders.all().map((order) => [order.id, order]));
    const bins = new Map(store.variants.all().map((variant) => [variant.sku, variant.sku.slice(0, 2)]));
    return ok({ rows: pickList(store.fulfilments.pending(), orders, bins) });
  });

  router.get("/fulfilments/:id/packing-slip", (request: Request) => {
    const fulfilment = store.fulfilments.find(request.query.id);
    if (!fulfilment) throw notFound("Fulfilment");

    const order = load(fulfilment.orderId);
    const bins = new Map(store.variants.all().map((variant) => [variant.sku, variant.sku.slice(0, 2)]));
    return ok({ slip: packingSlip(order, fulfilment, bins) });
  });

  router.get("/returns", () => ok({ returns: store.returns.open() }));

  router.post("/returns/:id/approve", (request: Request) => {
    const returnRequest = store.returns.find(request.query.id);
    if (!returnRequest) throw notFound("Return");

    approve(returnRequest, optionalField(request.body, "labelUrl", null), new Date());
    bus.emit("return.approved", { request: returnRequest }, request.correlationId);
    return ok({ return: returnRequest });
  });

  router.post("/returns/:id/receive", (request: Request) => {
    const returnRequest = store.returns.find(request.query.id);
    if (!returnRequest) throw notFound("Return");

    const inspection = new Map(Object.entries(optionalField<Record<string, boolean>>(request.body, "inspection", {})));
    receive(returnRequest, inspection, new Date());

    const order = load(returnRequest.orderId);
    const refundRecord = calculateRefund(order, returnRequest, request.actor?.id ?? "system");
    store.refunds.insert(refundRecord);
    applyRefund(order, refundRecord);

    for (const line of returnRequest.lines) {
      if (!line.restockable) continue;
      const orderLine = order.lines.find((l) => l.id === line.orderLineId);
      if (!orderLine) continue;
      const levels = store.inventory.forVariant(orderLine.variantId);
      if (levels[0]) store.inventory.setLevel(restock(levels[0], line.quantity));
    }

    recomputeStatuses(order);
    bus.emit("return.received", { request: returnRequest }, request.correlationId);

    return ok({ return: returnRequest, refund: refundRecord });
  });

  router.get("/reports/orders", (request: Request) => {
    const from = request.query.from ?? "1970-01-01";
    const to = request.query.to ?? "2999-12-31";
    const orders = store.orders.between(from, to);

    return ok({
      metrics: metrics(orders, "EUR"),
      returnsByReason: returnsByReason(
        store.returns.all(),
        new Map(store.orders.all().map((o) => [o.id, o])),
        "EUR",
      ),
    });
  });

  return router;
}
