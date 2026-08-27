import { Money } from "../money";
import type { StatementLine } from "../reconciliation";

/**
 * Bank statement import.
 *
 * Banks all export slightly different CSV, so the parser takes a column
 * mapping. Amounts may be a single signed column or a debit/credit pair.
 */

export interface ColumnMap {
  date: string;
  description: string;
  counterparty: string;
  /** Single signed amount column. */
  amount?: string;
  /** Or a pair of columns. */
  debit?: string;
  credit?: string;
  /** Bank's own transaction id, used to skip duplicates on re-import. */
  reference?: string;
}

export interface ImportOptions {
  columns: ColumnMap;
  currencyCode: string;
  delimiter: string;
  /** Set when the file uses 1.234,56 rather than 1,234.56. */
  europeanNumbers: boolean;
  /** Format of the date column. */
  dateFormat: "YYYY-MM-DD" | "DD-MM-YYYY" | "MM/DD/YYYY";
}

export const DEFAULT_IMPORT: ImportOptions = {
  columns: { date: "Date", description: "Description", counterparty: "Name", amount: "Amount" },
  currencyCode: "EUR",
  delimiter: ",",
  europeanNumbers: false,
  dateFormat: "YYYY-MM-DD",
};

export interface ImportResult {
  lines: StatementLine[];
  skipped: number;
  errors: { row: number; message: string }[];
}

/** Split a CSV line, honouring double quoted fields. */
export function splitRow(row: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const ch = row[i];

    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  out.push(current);
  return out.map((cell) => cell.trim());
}

export function normaliseDate(raw: string, format: ImportOptions["dateFormat"]): string {
  const cleaned = raw.trim();
  switch (format) {
    case "DD-MM-YYYY": {
      const [d, m, y] = cleaned.split(/[-/.]/);
      return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    case "MM/DD/YYYY": {
      const [m, d, y] = cleaned.split(/[-/.]/);
      return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    default:
      return cleaned.slice(0, 10);
  }
}

export function parseAmount(raw: string, european: boolean): number {
  let cleaned = raw.replace(/[^\d.,\-+]/g, "").trim();
  if (european) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }
  const value = Number(cleaned);
  if (Number.isNaN(value)) throw new Error(`cannot read "${raw}" as an amount`);
  return value;
}

/** Parse a whole file into statement lines. */
export function importStatement(csv: string, options: ImportOptions = DEFAULT_IMPORT): ImportResult {
  const rows = csv.split(/\r?\n/).filter((r) => r.trim().length > 0);
  if (rows.length < 2) {
    return { lines: [], skipped: 0, errors: [{ row: 0, message: "file has no data rows" }] };
  }

  const header = splitRow(rows[0], options.delimiter);
  const indexOf = (name: string | undefined): number => (name ? header.indexOf(name) : -1);

  const dateAt = indexOf(options.columns.date);
  const descriptionAt = indexOf(options.columns.description);
  const counterpartyAt = indexOf(options.columns.counterparty);
  const amountAt = indexOf(options.columns.amount);
  const debitAt = indexOf(options.columns.debit);
  const creditAt = indexOf(options.columns.credit);
  const referenceAt = indexOf(options.columns.reference);

  const lines: StatementLine[] = [];
  const errors: ImportResult["errors"] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const cells = splitRow(rows[i], options.delimiter);

    try {
      let value: number;
      if (amountAt >= 0) {
        value = parseAmount(cells[amountAt], options.europeanNumbers);
      } else {
        const debit = cells[debitAt] ? parseAmount(cells[debitAt], options.europeanNumbers) : 0;
        const credit = cells[creditAt] ? parseAmount(cells[creditAt], options.europeanNumbers) : 0;
        value = debit - credit;
      }

      const id = referenceAt >= 0 ? cells[referenceAt] : `row-${i}`;
      if (seen.has(id)) {
        skipped++;
        continue;
      }
      seen.add(id);

      lines.push({
        id,
        date: normaliseDate(cells[dateAt], options.dateFormat),
        amount: Money.fromMajor(value, options.currencyCode),
        description: cells[descriptionAt] ?? "",
        counterparty: cells[counterpartyAt] ?? "",
      });
    } catch (err) {
      errors.push({ row: i + 1, message: (err as Error).message });
    }
  }

  return { lines, skipped, errors };
}

/** Sanity check: does the file's own running balance agree with the lines? */
export function checkRunningBalance(lines: StatementLine[], opening: Money, closing: Money): boolean {
  let running = opening;
  for (const line of lines) {
    running = running.plus(line.amount);
  }
  return running.equals(closing);
}
