import { Router } from "../router";
import { created, field, intQuery, noContent, notFound, ok, optionalField, type Request } from "../middleware";
import type { Store } from "../../store/repositories";
import type { EventBus } from "../../events/bus";
import {
  anonymise,
  create as createCustomer,
  exportData,
  fullName,
  metricsFor,
  segmentOf,
} from "../../domain/customer";
import { cohorts } from "../../analytics";
import { format } from "../../domain/money";

/** Admin customer management. */
export function adminCustomerRoutes(store: Store, bus: EventBus): Router {
  const router = new Router();

  router.get("/customers", (request: Request) => {
    const page = intQuery(request, "page", 1);
    const pageSize = intQuery(request, "pageSize", 50);
    const term = (request.query.q ?? "").toLowerCase();

    const matching = store.customers.where(
      (customer) =>
        !term ||
        customer.email.includes(term) ||
        fullName(customer).toLowerCase().includes(term) ||
        (customer.phone ?? "").includes(term),
    );

    return ok({
      customers: matching.slice((page - 1) * pageSize, page * pageSize).map((customer) => {
        const orders = store.orders.byCustomer(customer.id);
        const metrics = metricsFor(customer, orders);

        return {
          id: customer.id,
          email: customer.email,
          name: fullName(customer),
          state: customer.state,
          groups: customer.groups,
          orderCount: metrics.orderCount,
          lifetimeValue: metrics.lifetimeValue,
          lifetimeValueFormatted: format(metrics.lifetimeValue),
          segment: segmentOf(metrics),
          createdAt: customer.createdAt,
        };
      }),
      total: matching.length,
      page,
      pageSize,
    });
  });

  router.post("/customers", (request: Request) => {
    const customer = createCustomer({
      email: field<string>(request.body, "email"),
      firstName: optionalField(request.body, "firstName", ""),
      lastName: optionalField(request.body, "lastName", ""),
      phone: optionalField(request.body, "phone", undefined),
    });

    store.customers.insert(customer);
    bus.emit("customer.created", { customer }, request.correlationId);
    return created({ customer });
  });

  router.get("/customers/:id", (request: Request) => {
    const customer = store.customers.find(request.query.id);
    if (!customer) throw notFound("Customer");

    const orders = store.orders.byCustomer(customer.id);
    const metrics = metricsFor(customer, orders);

    return ok({
      customer,
      metrics,
      segment: segmentOf(metrics),
      orders: orders.map((order) => ({
        id: order.id,
        name: order.name,
        createdAt: order.createdAt,
        total: order.total,
        status: order.status,
      })),
    });
  });

  router.patch("/customers/:id", (request: Request) => {
    const customer = store.customers.find(request.query.id);
    if (!customer) throw notFound("Customer");

    Object.assign(customer, request.body as object);
    customer.updatedAt = new Date().toISOString();

    bus.emit("customer.updated", { customer }, request.correlationId);
    return ok({ customer });
  });

  router.post("/customers/:id/groups", (request: Request) => {
    const customer = store.customers.find(request.query.id);
    if (!customer) throw notFound("Customer");

    const group = field<string>(request.body, "group");
    if (!customer.groups.includes(group)) customer.groups.push(group);

    return ok({ customer });
  });

  router.post("/customers/:id/anonymise", (request: Request) => {
    const customer = store.customers.find(request.query.id);
    if (!customer) throw notFound("Customer");

    anonymise(customer);
    bus.emit("customer.deleted", { customerId: customer.id }, request.correlationId);
    return ok({ customer });
  });

  router.get("/customers/:id/export", (request: Request) => {
    const customer = store.customers.find(request.query.id);
    if (!customer) throw notFound("Customer");

    return ok(exportData(customer, store.orders.all()));
  });

  router.delete("/customers/:id", (request: Request) => {
    if (!store.customers.remove(request.query.id)) throw notFound("Customer");
    return noContent();
  });

  router.get("/customers/reports/cohorts", (request: Request) =>
    ok({
      cohorts: cohorts(store.customers.all(), store.orders.all(), intQuery(request, "months", 12), "EUR"),
    }),
  );

  router.get("/customers/reports/segments", () => {
    const counts = new Map<string, number>();

    for (const customer of store.customers.all()) {
      const segment = segmentOf(metricsFor(customer, store.orders.byCustomer(customer.id)));
      counts.set(segment, (counts.get(segment) ?? 0) + 1);
    }

    return ok({ segments: [...counts.entries()].map(([segment, count]) => ({ segment, count })) });
  });

  return router;
}
