import { randomUUID } from "node:crypto";
import { Money } from "./money";
import type { Ledger } from "./ledger";

/**
 * Fixed asset register and depreciation schedules.
 *
 * Two methods are supported: straight line, which spreads the depreciable
 * amount evenly, and reducing balance, which applies a fixed percentage to
 * the carrying value each year.
 */

export type DepreciationMethod = "straight-line" | "reducing-balance";

export interface FixedAsset {
  id: string;
  code: string;
  description: string;
  /** What was paid, excluding recoverable VAT. */
  cost: Money;
  /** What it is expected to be worth at the end of its life. */
  residual: Money;
  /** In months. */
  usefulLife: number;
  method: DepreciationMethod;
  /** Percentage per year, reducing balance only. */
  ratePercent: number;
  acquiredOn: string;
  disposedOn: string | null;
  disposalProceeds: Money | null;
  assetAccount: string;
  accumulatedAccount: string;
  expenseAccount: string;
}

export interface AssetInput {
  code: string;
  description: string;
  cost: Money;
  residual?: Money;
  usefulLife: number;
  method?: DepreciationMethod;
  ratePercent?: number;
  acquiredOn: string;
  assetAccount?: string;
  accumulatedAccount?: string;
  expenseAccount?: string;
}

export interface ScheduleRow {
  periodId: string;
  openingValue: Money;
  charge: Money;
  accumulated: Money;
  closingValue: Money;
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function addMonths(periodId: string, n: number): string {
  const [year, month] = periodId.split("-").map(Number);
  const total = (year * 12 + (month - 1)) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export class AssetRegister {
  private assets = new Map<string, FixedAsset>();

  constructor(private readonly ledger: Ledger) {}

  add(input: AssetInput): FixedAsset {
    const currencyCode = input.cost.currencyCode;
    const asset: FixedAsset = {
      id: randomUUID(),
      code: input.code,
      description: input.description,
      cost: input.cost,
      residual: input.residual ?? Money.zero(currencyCode),
      usefulLife: input.usefulLife,
      method: input.method ?? "straight-line",
      ratePercent: input.ratePercent ?? 20,
      acquiredOn: input.acquiredOn,
      disposedOn: null,
      disposalProceeds: null,
      assetAccount: input.assetAccount ?? "1500",
      accumulatedAccount: input.accumulatedAccount ?? "1550",
      expenseAccount: input.expenseAccount ?? "7000",
    };
    this.assets.set(asset.id, asset);
    return asset;
  }

  get(id: string): FixedAsset {
    const asset = this.assets.get(id);
    if (!asset) throw new Error(`no asset ${id}`);
    return asset;
  }

  list(): FixedAsset[] {
    return [...this.assets.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  /** The full month by month schedule for an asset. */
  schedule(assetId: string): ScheduleRow[] {
    const asset = this.get(assetId);
    const depreciable = asset.cost.minus(asset.residual);
    const rows: ScheduleRow[] = [];

    let accumulated = Money.zero(asset.cost.currencyCode);
    let carrying = asset.cost;
    const startPeriod = asset.acquiredOn.slice(0, 7);

    for (let i = 0; i < asset.usefulLife; i++) {
      const periodId = addMonths(startPeriod, i);

      let charge: Money;
      if (asset.method === "straight-line") {
        charge = depreciable.dividedBy(asset.usefulLife);
      } else {
        charge = carrying.times(asset.ratePercent / 100 / 12);
      }

      accumulated = accumulated.plus(charge);
      carrying = asset.cost.minus(accumulated);

      rows.push({
        periodId,
        openingValue: rows.length === 0 ? asset.cost : rows[rows.length - 1].closingValue,
        charge,
        accumulated,
        closingValue: carrying,
      });
    }

    return rows;
  }

  /** Depreciation charge for one period across every live asset. */
  chargeFor(periodId: string): { asset: FixedAsset; charge: Money }[] {
    const out: { asset: FixedAsset; charge: Money }[] = [];

    for (const asset of this.list()) {
      if (asset.disposedOn && asset.disposedOn.slice(0, 7) < periodId) continue;
      const row = this.schedule(asset.id).find((r) => r.periodId === periodId);
      if (row) out.push({ asset, charge: row.charge });
    }

    return out;
  }

  /** Post the monthly depreciation journal. */
  postCharge(periodId: string): string | null {
    const charges = this.chargeFor(periodId);
    if (charges.length === 0) return null;

    const postings = charges.flatMap(({ asset, charge }) => [
      { accountCode: asset.expenseAccount, amount: charge, side: "debit" as const, memo: asset.code },
      { accountCode: asset.accumulatedAccount, amount: charge, side: "credit" as const, memo: asset.code },
    ]);

    const entry = this.ledger.post({
      date: `${periodId}-28`,
      description: `Depreciation ${periodId}`,
      reference: `DEP-${periodId}`,
      postings,
    });

    return entry.id;
  }

  /** Carrying value at a date. */
  carryingValue(assetId: string, asOf: string): Money {
    const asset = this.get(assetId);
    const elapsed = monthsBetween(asset.acquiredOn, asOf);
    const rows = this.schedule(assetId).slice(0, elapsed);
    if (rows.length === 0) return asset.cost;
    return rows[rows.length - 1].closingValue;
  }

  /** Sell or scrap an asset, booking the gain or loss. */
  dispose(assetId: string, date: string, proceeds: Money): { gain: Money; entryId: string } {
    const asset = this.get(assetId);
    if (asset.disposedOn) throw new Error(`asset ${asset.code} is already disposed`);

    const carrying = this.carryingValue(assetId, date);
    const accumulated = asset.cost.minus(carrying);
    const gain = proceeds.minus(carrying);

    const postings = [
      { accountCode: "1010", amount: proceeds, side: "debit" as const, memo: asset.code },
      { accountCode: asset.accumulatedAccount, amount: accumulated, side: "debit" as const, memo: asset.code },
      { accountCode: asset.assetAccount, amount: asset.cost, side: "credit" as const, memo: asset.code },
    ];

    if (gain.isPositive()) {
      postings.push({ accountCode: "4900", amount: gain, side: "credit" as const, memo: `Gain on ${asset.code}` });
    } else if (gain.isNegative()) {
      postings.push({ accountCode: "6900", amount: gain.abs(), side: "debit" as const, memo: `Loss on ${asset.code}` });
    }

    const entry = this.ledger.post({
      date,
      description: `Disposal of ${asset.code}`,
      reference: `DISP-${asset.code}`,
      postings,
    });

    asset.disposedOn = date;
    asset.disposalProceeds = proceeds;

    return { gain, entryId: entry.id };
  }
}
