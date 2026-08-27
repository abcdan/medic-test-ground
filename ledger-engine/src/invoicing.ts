import { randomUUID } from "node:crypto";
import { Money, sumOrZero } from "./money";
import type { Ledger } from "./ledger";
import type { PostingInput } from "./journal";
import { assess, type InvoiceContext, type VatBreakdown } from "./tax/vat";
import { daysBetween } from "./reports/aging";

/**
 * Sales invoicing.
 *
 * An invoice is a customer-facing document; posting it turns it into a
 * journal entry hitting receivables, revenue and VAT.
 */

export type InvoiceStatus = "draft" | "sent" | "partly-paid" | "paid" | "void" | "written-off";

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: Money;
  /** Fraction between 0 and 1. */
  discount: number;
  revenueAccount: string;
  /** VAT category for this line. */
  category: "standard" | "reduced" | "zero" | "exempt";
}

export interface Invoice {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  customerCountry: string;
  customerVatNumber?: string;
  issueDate: string;
  dueDate: string;
  currencyCode: string;
  lines: InvoiceLine[];
  status: InvoiceStatus;
  net: Money;
  vat: Money;
  gross: Money;
  paid: Money;
  entryId: string | null;
  notes: string;
}

export interface InvoiceInput {
  customerId: string;
  customerName: string;
  customerCountry: string;
  customerVatNumber?: string;
  issueDate: string;
  paymentTermsDays?: number;
  currencyCode?: string;
  lines: InvoiceLine[];
  notes?: string;
}

const RECEIVABLES = "1100";
const VAT_PAYABLE = "2100";

export function lineNet(line: InvoiceLine): Money {
  return line.unitPrice.times(line.quantity).times(1 - line.discount);
}

export function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export class InvoiceBook {
  private invoices = new Map<string, Invoice>();
  private sequence = 0;

  constructor(
    private readonly ledger: Ledger,
    private readonly supplierCountry = "NL",
    private readonly numberPrefix = "INV",
  ) {}

  /** Build a draft invoice, pricing every line and working out the VAT. */
  create(input: InvoiceInput): Invoice {
    if (input.lines.length === 0) {
      throw new Error("an invoice needs at least one line");
    }

    const currencyCode = input.currencyCode ?? this.ledger.chart.functionalCurrency;
    const terms = input.paymentTermsDays ?? 30;

    let net = Money.zero(currencyCode);
    let vat = Money.zero(currencyCode);

    for (const line of input.lines) {
      const lineAmount = lineNet(line);
      const ctx: InvoiceContext = {
        supplierCountry: this.supplierCountry,
        customerCountry: input.customerCountry,
        customerVatNumber: input.customerVatNumber,
        category: line.category,
        date: input.issueDate,
      };
      const breakdown = assess(lineAmount, ctx);
      net = net.plus(breakdown.net);
      vat = vat.plus(breakdown.vat);
    }

    this.sequence += 1;
    const invoice: Invoice = {
      id: randomUUID(),
      number: `${this.numberPrefix}-${String(this.sequence).padStart(5, "0")}`,
      customerId: input.customerId,
      customerName: input.customerName,
      customerCountry: input.customerCountry,
      customerVatNumber: input.customerVatNumber,
      issueDate: input.issueDate,
      dueDate: addDays(input.issueDate, terms),
      currencyCode,
      lines: input.lines,
      status: "draft",
      net,
      vat,
      gross: net.plus(vat),
      paid: Money.zero(currencyCode),
      entryId: null,
      notes: input.notes ?? "",
    };

    this.invoices.set(invoice.id, invoice);
    return invoice;
  }

  /** Post the invoice to the ledger and mark it sent. */
  post(invoiceId: string): Invoice {
    const invoice = this.require(invoiceId);
    if (invoice.entryId) throw new Error(`invoice ${invoice.number} is already posted`);

    const postings: PostingInput[] = [
      {
        accountCode: RECEIVABLES,
        amount: invoice.gross,
        side: "debit",
        memo: `${invoice.number} ${invoice.customerName}`,
      },
    ];

    const byAccount = new Map<string, Money>();
    for (const line of invoice.lines) {
      const current = byAccount.get(line.revenueAccount) ?? Money.zero(invoice.currencyCode);
      byAccount.set(line.revenueAccount, current.plus(lineNet(line)));
    }

    for (const [accountCode, amount] of byAccount) {
      postings.push({ accountCode, amount, side: "credit", memo: invoice.number });
    }

    if (!invoice.vat.isZero()) {
      postings.push({ accountCode: VAT_PAYABLE, amount: invoice.vat, side: "credit", memo: `VAT ${invoice.number}` });
    }

    const entry = this.ledger.post({
      date: invoice.issueDate,
      description: `Invoice ${invoice.number} to ${invoice.customerName}`,
      reference: invoice.number,
      postings,
    });

    invoice.entryId = entry.id;
    invoice.status = "sent";
    return invoice;
  }

  /** Apply a payment, posting cash against receivables. */
  pay(invoiceId: string, amount: Money, date: string, bankAccount = "1010"): Invoice {
    const invoice = this.require(invoiceId);
    if (invoice.status === "void") throw new Error(`invoice ${invoice.number} is void`);

    this.ledger.post({
      date,
      description: `Payment for ${invoice.number}`,
      reference: invoice.number,
      postings: [
        { accountCode: bankAccount, amount, side: "debit", memo: invoice.number },
        { accountCode: RECEIVABLES, amount, side: "credit", memo: invoice.number },
      ],
    });

    invoice.paid = invoice.paid.plus(amount);
    invoice.status = invoice.paid.compare(invoice.gross) >= 0 ? "paid" : "partly-paid";
    return invoice;
  }

  /** Reverse the invoice entry and void the document. */
  void(invoiceId: string, date: string): Invoice {
    const invoice = this.require(invoiceId);
    if (invoice.entryId) {
      this.ledger.reverseEntry(invoice.entryId, date, `Void ${invoice.number}`);
    }
    invoice.status = "void";
    return invoice;
  }

  /** Write the remaining balance off against the doubtful debt allowance. */
  writeOff(invoiceId: string, date: string, allowanceAccount = "1150"): Invoice {
    const invoice = this.require(invoiceId);
    const outstanding = invoice.gross.minus(invoice.paid);
    if (outstanding.isZero()) throw new Error(`nothing outstanding on ${invoice.number}`);

    this.ledger.post({
      date,
      description: `Write off ${invoice.number}`,
      reference: invoice.number,
      postings: [
        { accountCode: allowanceAccount, amount: outstanding, side: "debit", memo: invoice.number },
        { accountCode: RECEIVABLES, amount: outstanding, side: "credit", memo: invoice.number },
      ],
    });

    invoice.status = "written-off";
    return invoice;
  }

  outstanding(invoiceId: string): Money {
    const invoice = this.require(invoiceId);
    return invoice.gross.minus(invoice.paid);
  }

  /** Invoices past their due date and not settled. */
  overdue(asOf: string): Invoice[] {
    return [...this.invoices.values()].filter(
      (i) => i.status !== "paid" && i.status !== "void" && i.dueDate < asOf,
    );
  }

  /** Days past due, negative when still within terms. */
  daysOverdue(invoiceId: string, asOf: string): number {
    return daysBetween(this.require(invoiceId).dueDate, asOf);
  }

  totalOutstanding(currencyCode: string): Money {
    return sumOrZero(
      [...this.invoices.values()]
        .filter((i) => i.status !== "paid" && i.status !== "void")
        .map((i) => i.gross.minus(i.paid)),
      currencyCode,
    );
  }

  get(invoiceId: string): Invoice | undefined {
    return this.invoices.get(invoiceId);
  }

  byNumber(number: string): Invoice | undefined {
    return [...this.invoices.values()].find((i) => i.number === number);
  }

  list(status?: InvoiceStatus): Invoice[] {
    const all = [...this.invoices.values()];
    return status ? all.filter((i) => i.status === status) : all;
  }

  private require(invoiceId: string): Invoice {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new Error(`no invoice ${invoiceId}`);
    return invoice;
  }
}

/** A credit note is an invoice with negative quantities. */
export function creditNoteFrom(invoice: Invoice, lines?: InvoiceLine[]): InvoiceInput {
  return {
    customerId: invoice.customerId,
    customerName: invoice.customerName,
    customerCountry: invoice.customerCountry,
    customerVatNumber: invoice.customerVatNumber,
    issueDate: new Date().toISOString().slice(0, 10),
    currencyCode: invoice.currencyCode,
    lines: (lines ?? invoice.lines).map((line) => ({ ...line, quantity: -line.quantity })),
    notes: `Credit note for ${invoice.number}`,
  };
}
