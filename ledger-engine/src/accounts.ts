import type { Money } from "./money";

/**
 * Chart of accounts.
 *
 * The five classic types. `debit` accounts increase on the debit side,
 * `credit` accounts increase on the credit side.
 */
export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export type NormalBalance = "debit" | "credit";

export const NORMAL_BALANCE: Record<AccountType, NormalBalance> = {
  asset: "debit",
  expense: "debit",
  liability: "credit",
  equity: "credit",
  revenue: "credit",
};

export interface Account {
  /** Stable code, e.g. "1000" for cash. */
  code: string;
  name: string;
  type: AccountType;
  currencyCode: string;
  /** Parent account code, for roll-ups. */
  parent: string | null;
  /**
   * A contra account sits against its parent and carries the opposite
   * normal balance, e.g. accumulated depreciation against fixed assets.
   */
  contra: boolean;
  /** Postings are rejected once an account is archived. */
  archived: boolean;
  description: string;
}

export interface AccountInput {
  code: string;
  name: string;
  type: AccountType;
  currencyCode?: string;
  parent?: string | null;
  contra?: boolean;
  description?: string;
}

export class DuplicateAccountError extends Error {
  constructor(readonly code: string) {
    super(`account ${code} already exists`);
    this.name = "DuplicateAccountError";
  }
}

export class UnknownAccountError extends Error {
  constructor(readonly code: string) {
    super(`no account ${code}`);
    this.name = "UnknownAccountError";
  }
}

export class ChartOfAccounts {
  private accounts = new Map<string, Account>();

  constructor(readonly functionalCurrency: string = "EUR") {}

  add(input: AccountInput): Account {
    if (this.accounts.has(input.code)) {
      throw new DuplicateAccountError(input.code);
    }
    if (input.parent && !this.accounts.has(input.parent)) {
      throw new UnknownAccountError(input.parent);
    }

    const account: Account = {
      code: input.code,
      name: input.name,
      type: input.type,
      currencyCode: (input.currencyCode ?? this.functionalCurrency).toUpperCase(),
      parent: input.parent ?? null,
      contra: input.contra ?? false,
      archived: false,
      description: input.description ?? "",
    };

    this.accounts.set(account.code, account);
    return account;
  }

  addAll(inputs: AccountInput[]): Account[] {
    return inputs.map((input) => this.add(input));
  }

  get(code: string): Account {
    const account = this.accounts.get(code);
    if (!account) throw new UnknownAccountError(code);
    return account;
  }

  find(code: string): Account | undefined {
    return this.accounts.get(code);
  }

  has(code: string): boolean {
    return this.accounts.has(code);
  }

  archive(code: string): void {
    this.get(code).archived = true;
  }

  list(type?: AccountType): Account[] {
    const all = [...this.accounts.values()];
    const filtered = type ? all.filter((a) => a.type === type) : all;
    return filtered.sort((a, b) => a.code.localeCompare(b.code));
  }

  /** Direct children of an account. */
  children(code: string): Account[] {
    return this.list().filter((a) => a.parent === code);
  }

  /** Every descendant, depth first. */
  descendants(code: string): Account[] {
    const out: Account[] = [];
    for (const child of this.children(code)) {
      out.push(child);
      out.push(...this.descendants(child.code));
    }
    return out;
  }

  /** Chain from an account up to its root, nearest first. */
  ancestors(code: string): Account[] {
    const out: Account[] = [];
    let current = this.get(code).parent;
    while (current) {
      const parent = this.get(current);
      out.push(parent);
      current = parent.parent;
    }
    return out;
  }

  /** Which side increases this account. */
  normalBalance(code: string): NormalBalance {
    const account = this.get(code);
    const base = NORMAL_BALANCE[account.type];
    if (account.contra) {
      return base === "debit" ? "credit" : "debit";
    }
    return base;
  }

  /** Accounts that appear on the balance sheet rather than the P&L. */
  isBalanceSheet(code: string): boolean {
    const type = this.get(code).type;
    return type === "asset" || type === "liability" || type === "equity";
  }

  get size(): number {
    return this.accounts.size;
  }
}

/** A conventional starting chart, enough to run a small company on. */
export const STANDARD_CHART: AccountInput[] = [
  { code: "1000", name: "Cash", type: "asset" },
  { code: "1010", name: "Bank - current", type: "asset", parent: "1000" },
  { code: "1020", name: "Bank - savings", type: "asset", parent: "1000" },
  { code: "1100", name: "Accounts receivable", type: "asset" },
  { code: "1150", name: "Allowance for doubtful accounts", type: "asset", parent: "1100", contra: true },
  { code: "1200", name: "Inventory", type: "asset" },
  { code: "1500", name: "Fixed assets", type: "asset" },
  { code: "1550", name: "Accumulated depreciation", type: "asset", parent: "1500", contra: true },
  { code: "2000", name: "Accounts payable", type: "liability" },
  { code: "2100", name: "VAT payable", type: "liability" },
  { code: "2110", name: "VAT receivable", type: "liability", parent: "2100", contra: true },
  { code: "2500", name: "Loans", type: "liability" },
  { code: "3000", name: "Share capital", type: "equity" },
  { code: "3100", name: "Retained earnings", type: "equity" },
  { code: "4000", name: "Sales", type: "revenue" },
  { code: "4100", name: "Sales returns", type: "revenue", parent: "4000", contra: true },
  { code: "4900", name: "FX gains", type: "revenue" },
  { code: "5000", name: "Cost of goods sold", type: "expense" },
  { code: "6000", name: "Salaries", type: "expense" },
  { code: "6100", name: "Rent", type: "expense" },
  { code: "6200", name: "Software", type: "expense" },
  { code: "6900", name: "FX losses", type: "expense" },
  { code: "7000", name: "Depreciation", type: "expense" },
];
