import { type Money, add, subtract, sumAll, zero } from "../domain/money";
import type { Order } from "../domain/order";
import type { Refund } from "../domain/returns";
import type { Transaction } from "../domain/payment";

/**
 * Export to the bookkeeping system.
 *
 * Each order becomes a sales invoice, each refund a credit note, and each
 * payout a bank transaction. The mapping from tax code to ledger account
 * is configurable per shop.
 */

export interface LedgerMapping {
  salesAccount: string;
  salesTaxAccount: string;
  shippingAccount: string;
  receivablesAccount: string;
  bankAccount: string;
  discountAccount: string;
  giftCardLiabilityAccount: string;
  /** Overrides by product tax code. */
  byTaxCode: Record<string, string>;
}

export const DEFAULT_MAPPING: LedgerMapping = {
  salesAccount: "8000",
  salesTaxAccount: "1500",
  shippingAccount: "8100",
  receivablesAccount: "1300",
  bankAccount: "1100",
  discountAccount: "8010",
  giftCardLiabilityAccount: "2400",
  byTaxCode: {},
};

export interface JournalLine {
  account: string;
  description: string;
  debit: Money;
  credit: Money;
  taxCode: string | null;
}

export interface JournalEntry {
  reference: string;
  date: string;
  description: string;
  lines: JournalLine[];
  currency: string;
}

function debit(account: string, description: string, amount: Money, taxCode: string | null = null): JournalLine {
  return { account, description, debit: amount, credit: zero(amount.currency), taxCode };
}

function credit(account: string, description: string, amount: Money, taxCode: string | null = null): JournalLine {
  return { account, description, debit: zero(amount.currency), credit: amount, taxCode };
}

/** Turn an order into a sales invoice journal. */
export function orderToJournal(order: Order, mapping: LedgerMapping): JournalEntry {
  const lines: JournalLine[] = [];

  lines.push(debit(mapping.receivablesAccount, `${order.name} ${order.email}`, order.total));

  const byAccount = new Map<string, Money>();

  for (const line of order.lines) {
    const account = mapping.byTaxCode[line.taxCode] ?? mapping.salesAccount;
    const net = subtract(line.lineTotal, line.discountTotal);
    byAccount.set(account, add(byAccount.get(account) ?? zero(order.currency), net));
  }

  for (const [account, amount] of byAccount) {
    lines.push(credit(account, `Sales ${order.name}`, amount));
  }

  if (order.shippingTotal.amount > 0) {
    lines.push(credit(mapping.shippingAccount, `Shipping ${order.name}`, order.shippingTotal));
  }

  if (order.taxTotal.amount > 0) {
    lines.push(credit(mapping.salesTaxAccount, `VAT ${order.name}`, order.taxTotal));
  }

  return {
    reference: order.name,
    date: order.createdAt.slice(0, 10),
    description: `Sales invoice ${order.name}`,
    lines,
    currency: order.currency,
  };
}

/** Turn a refund into a credit note journal. */
export function refundToJournal(refund: Refund, order: Order, mapping: LedgerMapping): JournalEntry {
  const lines: JournalLine[] = [
    debit(mapping.salesAccount, `Credit note ${order.name}`, refund.total),
    credit(mapping.receivablesAccount, `Credit note ${order.name}`, refund.total),
  ];

  return {
    reference: `CN-${order.name}`,
    date: refund.createdAt.slice(0, 10),
    description: `Credit note for ${order.name}`,
    lines,
    currency: order.currency,
  };
}

/** Turn a settled payment into a bank journal. */
export function paymentToJournal(transaction: Transaction, order: Order, mapping: LedgerMapping): JournalEntry {
  return {
    reference: transaction.gatewayReference ?? transaction.id,
    date: transaction.createdAt.slice(0, 10),
    description: `Payment for ${order.name}`,
    lines: [
      debit(mapping.bankAccount, `Payment ${order.name}`, transaction.amount),
      credit(mapping.receivablesAccount, `Payment ${order.name}`, transaction.amount),
    ],
    currency: transaction.amount.currency,
  };
}

/** Does a journal balance? */
export function isBalanced(entry: JournalEntry): boolean {
  const debits = sumAll(entry.lines.map((line) => line.debit), entry.currency);
  const credits = sumAll(entry.lines.map((line) => line.credit), entry.currency);
  return debits.amount === credits.amount;
}

export interface ExportBatch {
  from: string;
  to: string;
  entries: JournalEntry[];
  totalDebits: Money;
  totalCredits: Money;
  balanced: boolean;
  generatedAt: string;
}

/** Everything in a window, ready to hand to the accountant. */
export function buildBatch(
  orders: Order[],
  refunds: Refund[],
  transactions: Transaction[],
  mapping: LedgerMapping,
  from: string,
  to: string,
  currency: string,
): ExportBatch {
  const inRange = orders.filter((order) => order.createdAt >= from && order.createdAt <= to);
  const orderIndex = new Map(orders.map((order) => [order.id, order]));

  const entries: JournalEntry[] = [];

  for (const order of inRange) {
    entries.push(orderToJournal(order, mapping));
  }

  for (const refund of refunds.filter((r) => r.createdAt >= from && r.createdAt <= to)) {
    const order = orderIndex.get(refund.orderId);
    if (order) entries.push(refundToJournal(refund, order, mapping));
  }

  for (const transaction of transactions.filter(
    (t) => t.kind === "capture" && t.status === "success" && t.createdAt >= from && t.createdAt <= to,
  )) {
    const order = orderIndex.get(transaction.orderId);
    if (order) entries.push(paymentToJournal(transaction, order, mapping));
  }

  const totalDebits = sumAll(entries.flatMap((e) => e.lines.map((l) => l.debit)), currency);
  const totalCredits = sumAll(entries.flatMap((e) => e.lines.map((l) => l.credit)), currency);

  return {
    from,
    to,
    entries,
    totalDebits,
    totalCredits,
    balanced: totalDebits.amount === totalCredits.amount,
    generatedAt: new Date().toISOString(),
  };
}

/** Render a batch as the CSV most bookkeeping packages accept. */
export function toCsv(batch: ExportBatch): string {
  const header = "date,reference,description,account,debit,credit,taxcode,currency";

  const rows = batch.entries.flatMap((entry) =>
    entry.lines.map((line) =>
      [
        entry.date,
        entry.reference,
        `"${line.description.replace(/"/g, '""')}"`,
        line.account,
        (line.debit.amount / 100).toFixed(2),
        (line.credit.amount / 100).toFixed(2),
        line.taxCode ?? "",
        entry.currency,
      ].join(","),
    ),
  );

  return [header, ...rows].join("\n");
}
