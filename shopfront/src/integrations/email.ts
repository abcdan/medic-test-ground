import { format } from "../domain/money";
import type { Order } from "../domain/order";
import type { Customer } from "../domain/customer";
import type { Fulfilment } from "../domain/fulfilment";
import type { Cart } from "../domain/cart";

/**
 * Transactional email.
 *
 * Templates render to HTML and plain text. Sending goes through a
 * provider adapter so the tests can assert on what would have gone out.
 */

export interface EmailMessage {
  to: string;
  from: string;
  replyTo: string | null;
  subject: string;
  html: string;
  text: string;
  tags: string[];
  /** Stops a retry sending twice. */
  idempotencyKey: string;
}

export interface EmailProvider {
  name: string;
  send(message: EmailMessage): Promise<{ id: string; accepted: boolean }>;
}

export interface EmailSettings {
  fromAddress: string;
  fromName: string;
  replyTo: string | null;
  shopName: string;
  shopUrl: string;
  supportEmail: string;
  logoUrl: string | null;
}

function layout(settings: EmailSettings, title: string, body: string): string {
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, sans-serif; color: #1c2128; margin: 0; padding: 24px; background: #f7f8fa;">
    <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 8px; padding: 32px;">
      ${settings.logoUrl ? `<img src="${settings.logoUrl}" alt="${settings.shopName}" height="32" />` : `<h1 style="font-size:20px">${settings.shopName}</h1>`}
      <h2 style="font-size: 18px;">${title}</h2>
      ${body}
      <hr style="border:none;border-top:1px solid #e2e5eb;margin:24px 0" />
      <p style="font-size:12px;color:#667085">
        Questions? Reply to this email or write to
        <a href="mailto:${settings.supportEmail}">${settings.supportEmail}</a>.
      </p>
    </div>
  </body>
</html>`;
}

function lineTable(order: Order): string {
  const rows = order.lines
    .map(
      (line) => `<tr>
        <td style="padding:6px 0">${line.title} ${line.variantTitle ? `<small>${line.variantTitle}</small>` : ""}</td>
        <td style="padding:6px 0;text-align:center">${line.quantity}</td>
        <td style="padding:6px 0;text-align:right">${format(line.lineTotal)}</td>
      </tr>`,
    )
    .join("");

  return `<table style="width:100%;border-collapse:collapse;font-size:14px">
    <tbody>${rows}</tbody>
    <tfoot>
      <tr><td colspan="2">Subtotal</td><td style="text-align:right">${format(order.subtotal)}</td></tr>
      <tr><td colspan="2">Shipping</td><td style="text-align:right">${format(order.shippingTotal)}</td></tr>
      <tr><td colspan="2">Tax</td><td style="text-align:right">${format(order.taxTotal)}</td></tr>
      <tr><td colspan="2"><strong>Total</strong></td><td style="text-align:right"><strong>${format(order.total)}</strong></td></tr>
    </tfoot>
  </table>`;
}

export function orderConfirmation(order: Order, settings: EmailSettings): EmailMessage {
  const body = `
    <p>Thanks for your order. We will let you know as soon as it ships.</p>
    ${lineTable(order)}
    <p style="margin-top:24px">
      <a href="${settings.shopUrl}/orders/${order.id}" style="background:#3b82f6;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">
        View your order
      </a>
    </p>`;

  return {
    to: order.email,
    from: `${settings.fromName} <${settings.fromAddress}>`,
    replyTo: settings.replyTo,
    subject: `Order ${order.name} confirmed`,
    html: layout(settings, `Order ${order.name} confirmed`, body),
    text: `Thanks for your order ${order.name}. Total ${format(order.total)}. View it at ${settings.shopUrl}/orders/${order.id}`,
    tags: ["transactional", "order-confirmation"],
    idempotencyKey: `order-confirmation:${order.id}`,
  };
}

export function shipmentNotification(order: Order, fulfilment: Fulfilment, settings: EmailSettings): EmailMessage {
  const tracking = fulfilment.trackingUrl
    ? `<p>Track it here: <a href="${fulfilment.trackingUrl}">${fulfilment.trackingNumber}</a></p>`
    : "";

  const body = `<p>Your order ${order.name} is on its way.</p>${tracking}${lineTable(order)}`;

  return {
    to: order.email,
    from: `${settings.fromName} <${settings.fromAddress}>`,
    replyTo: settings.replyTo,
    subject: `Order ${order.name} has shipped`,
    html: layout(settings, "On its way", body),
    text: `Your order ${order.name} has shipped. ${fulfilment.trackingUrl ?? ""}`,
    tags: ["transactional", "shipment"],
    idempotencyKey: `shipment:${fulfilment.id}`,
  };
}

export function refundNotification(order: Order, amount: string, settings: EmailSettings): EmailMessage {
  const body = `<p>We have refunded ${amount} against order ${order.name}. It can take a few working days to appear.</p>`;

  return {
    to: order.email,
    from: `${settings.fromName} <${settings.fromAddress}>`,
    replyTo: settings.replyTo,
    subject: `Refund for ${order.name}`,
    html: layout(settings, "Refund issued", body),
    text: `We have refunded ${amount} against order ${order.name}.`,
    tags: ["transactional", "refund"],
    idempotencyKey: `refund:${order.id}:${amount}`,
  };
}

export function abandonedCart(cart: Cart, settings: EmailSettings, discountCode?: string): EmailMessage {
  const items = cart.lines.map((line) => `<li>${line.title} × ${line.quantity}</li>`).join("");
  const incentive = discountCode
    ? `<p>Here is <strong>10% off</strong> with code <code>${discountCode}</code>.</p>`
    : "";

  const body = `
    <p>You left something behind.</p>
    <ul>${items}</ul>
    ${incentive}
    <p><a href="${settings.shopUrl}/cart/${cart.token}">Pick up where you left off</a></p>`;

  return {
    to: cart.email ?? "",
    from: `${settings.fromName} <${settings.fromAddress}>`,
    replyTo: settings.replyTo,
    subject: "You left something in your basket",
    html: layout(settings, "Still interested?", body),
    text: `You left items in your basket: ${settings.shopUrl}/cart/${cart.token}`,
    tags: ["marketing", "abandoned-cart"],
    idempotencyKey: `abandoned:${cart.id}`,
  };
}

export function passwordReset(customer: Customer, token: string, settings: EmailSettings): EmailMessage {
  const link = `${settings.shopUrl}/account/reset?token=${token}&email=${customer.email}`;

  return {
    to: customer.email,
    from: `${settings.fromName} <${settings.fromAddress}>`,
    replyTo: settings.replyTo,
    subject: "Reset your password",
    html: layout(settings, "Reset your password", `<p><a href="${link}">Choose a new password</a></p><p>This link is good for one hour.</p>`),
    text: `Reset your password: ${link}`,
    tags: ["transactional", "password-reset"],
    idempotencyKey: `password-reset:${customer.id}:${token}`,
  };
}

/** Provider that records rather than sends, used in tests and staging. */
export class MemoryEmailProvider implements EmailProvider {
  readonly name = "memory";
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage) {
    this.sent.push(message);
    return { id: message.idempotencyKey, accepted: true };
  }

  find(tag: string): EmailMessage[] {
    return this.sent.filter((message) => message.tags.includes(tag));
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/** Queue with retry, so a provider blip does not lose a receipt. */
export class EmailQueue {
  private queue: { message: EmailMessage; attempts: number }[] = [];
  private failed: EmailMessage[] = [];

  constructor(
    private readonly provider: EmailProvider,
    private readonly maxAttempts = 5,
  ) {}

  enqueue(message: EmailMessage): void {
    this.queue.push({ message, attempts: 0 });
  }

  async flush(): Promise<{ sent: number; failed: number }> {
    let sent = 0;

    for (const item of [...this.queue]) {
      item.attempts += 1;

      try {
        const result = await this.provider.send(item.message);
        if (result.accepted) {
          sent++;
          this.queue = this.queue.filter((q) => q !== item);
        }
      } catch {
        if (item.attempts >= this.maxAttempts) {
          this.failed.push(item.message);
          this.queue = this.queue.filter((q) => q !== item);
        }
      }
    }

    return { sent, failed: this.failed.length };
  }

  pending(): number {
    return this.queue.length;
  }

  deadLetters(): EmailMessage[] {
    return [...this.failed];
  }
}
