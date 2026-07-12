/**
 * Pure forecast engine, ported from budgeteer/engine.py.
 *
 * No I/O. Given phases, cash flows and optional actuals it produces a per-month
 * ledger and phase/period aggregates. Recurring cash flows are prorated by the
 * fraction of an "average" month/year they are active, using inclusive day counts.
 */
import {
  addDays,
  civilDate,
  day,
  daysInMonth,
  diffDays,
  maxDate,
  minDate,
  month,
  monthEnd,
  monthStart,
  monthStartsBetween,
  year,
} from "./dates";
import {
  type AnyCashFlow,
  Direction,
  EngineError,
  Frequency,
  type LiquidityActual,
  OneOffCashFlow,
  type Phase,
} from "./models";

export const MONTHLY_PERIOD_DAYS = 365.25 / 12;

export interface LedgerRow {
  monthYear: Date;
  activePhase: string | null;
  startingLiquidity: number;
  totalInflow: number;
  totalOutflow: number;
  netFlow: number;
  endingLiquidity: number;
}

interface PhaseSummary {
  activePhase: string;
  startingLiquidity: number;
  endingLiquidity: number;
  totalInflow: number;
  totalOutflow: number;
  netFlow: number;
  months: number;
}

export interface PeriodItem {
  name: string;
  direction: Direction;
  amount: number;
}

export interface PeriodSummary {
  startingLiquidity: number;
  endingLiquidity: number;
  items: PeriodItem[];
  periodStart: Date;
  periodEnd: Date;
}

export function buildTimeline(phases: Phase[]): Date[] {
  if (phases.length === 0) {
    throw new EngineError("At least one Phase is required");
  }
  let start = phases[0]?.startDate as Date;
  let end = phases[0]?.endDate as Date;
  for (const p of phases) {
    start = minDate(start, p.startDate);
    end = maxDate(end, p.endDate);
  }
  return monthStartsBetween(start, end);
}

function findActivePhase(m: Date, phases: Phase[]): string | null {
  const mEnd = monthEnd(m);
  for (const p of phases) {
    if (p.startDate.getTime() <= mEnd.getTime() && p.endDate.getTime() >= m.getTime()) {
      return p.name;
    }
  }
  return null;
}

function intervalOverlapDays(
  flowStart: Date | null,
  flowEnd: Date | null,
  windowStart: Date,
  windowEnd: Date
): number {
  const a = flowStart ?? windowStart;
  const b = flowEnd ?? windowEnd;
  const overlapStart = maxDate(a, windowStart);
  const overlapEnd = minDate(b, windowEnd);
  return Math.max(0, diffDays(overlapEnd, overlapStart) + 1);
}

function anchorDate(yr: number, mon: number, d: number): Date {
  const last = daysInMonth(yr, mon);
  return civilDate(yr, mon, Math.min(d, last));
}

export function activeFraction(cf: AnyCashFlow, m: Date, fromDate?: Date): number {
  const start = fromDate ?? m;
  const end = monthEnd(m);
  const amount = Math.abs(cashFlowAmount(cf, start, end));
  if (amount === 0) {
    return 0;
  }
  return cf instanceof OneOffCashFlow ? 1 : amount / cf.amount;
}

function annualLumpAmount(
  cf: RecurringCashFlow,
  start: Date,
  end: Date
): number {
  const anchorM = cf.startDate ? month(cf.startDate) : 1;
  const anchorD = cf.startDate ? day(cf.startDate) : 1;
  let total = 0;
  for (let yr = year(start); yr <= year(end); yr++) {
    const anchor = anchorDate(yr, anchorM, anchorD);
    if (
      anchor.getTime() >= start.getTime() &&
      anchor.getTime() <= end.getTime() &&
      (!cf.startDate || anchor.getTime() >= cf.startDate.getTime()) &&
      (!cf.endDate || anchor.getTime() <= cf.endDate.getTime())
    ) {
      total += cf.amount;
    }
  }
  return total;
}

function cashFlowAmount(cf: AnyCashFlow, start: Date, end: Date): number {
  const sign = cf.direction === Direction.Inflow ? 1 : -1;

  if (cf instanceof OneOffCashFlow) {
    return cf.date.getTime() >= start.getTime() && cf.date.getTime() <= end.getTime()
      ? sign * cf.amount
      : 0;
  }

  if (cf.frequency === Frequency.Monthly) {
    const days = intervalOverlapDays(cf.startDate, cf.endDate, start, end);
    return sign * cf.amount * (days / MONTHLY_PERIOD_DAYS);
  }

  return sign * annualLumpAmount(cf, start, end);
}

function balanceAt(
  cashFlows: AnyCashFlow[],
  date: Date,
  seedDate: Date,
  seedBalance: number
): number {
  if (date.getTime() < seedDate.getTime()) {
    return seedBalance;
  }
  let balance = seedBalance;
  for (const cf of cashFlows) {
    balance += cashFlowAmount(cf, seedDate, date);
  }
  return balance;
}

function latestActual(actuals: LiquidityActual[]): LiquidityActual {
  let latest = actuals[0] as LiquidityActual;
  for (const a of actuals) {
    if (a.date.getTime() > latest.date.getTime()) {
      latest = a;
    }
  }
  return latest;
}

export function computeLedger(
  timeline: Date[],
  phases: Phase[],
  cashFlows: AnyCashFlow[],
  actuals: LiquidityActual[] | null = null
): LedgerRow[] {
  let months = timeline;
  let flows = cashFlows;
  let balance = 0.0;

  if (actuals && actuals.length > 0) {
    const latest = latestActual(actuals);
    const latestMonth = monthStart(latest.date);
    months = timeline.filter((m) => m.getTime() >= latestMonth.getTime());
    balance = latest.amount;
    flows = cashFlows.filter(
      (cf) => !(cf instanceof OneOffCashFlow && cf.date.getTime() < latest.date.getTime())
    );
  }

  let seedDate: Date | undefined;
  if (actuals && actuals.length > 0) {
    seedDate = latestActual(actuals).date;
  }

  const rows: LedgerRow[] = [];
  for (const m of months) {
    const activePhase = findActivePhase(m, phases);
    const fromDate =
      seedDate && m.getTime() === monthStart(seedDate).getTime() ? seedDate : undefined;

    let totalInflow = 0.0;
    let totalOutflow = 0.0;
    for (const cf of flows) {
      const f = activeFraction(cf, m, fromDate);
      if (f <= 0) {
        continue;
      }
      if (cf.direction === Direction.Inflow) {
        totalInflow += cf.amount * f;
      } else {
        totalOutflow += cf.amount * f;
      }
    }

    const netFlow = totalInflow - totalOutflow;
    const ending = balance + netFlow;
    rows.push({
      monthYear: m,
      activePhase,
      startingLiquidity: balance,
      totalInflow,
      totalOutflow,
      netFlow,
      endingLiquidity: ending,
    });
    balance = ending;
  }

  return rows;
}

export function aggregateByPhase(ledger: LedgerRow[]): PhaseSummary[] {
  const order: string[] = [];
  const groups = new Map<string, LedgerRow[]>();
  for (const row of ledger) {
    if (row.activePhase === null) {
      continue;
    }
    let group = groups.get(row.activePhase);
    if (!group) {
      group = [];
      groups.set(row.activePhase, group);
      order.push(row.activePhase);
    }
    group.push(row);
  }

  return order.map((name) => {
    const group = groups.get(name) as LedgerRow[];
    const first = group[0] as LedgerRow;
    const last = group.at(-1) as LedgerRow;
    return {
      activePhase: name,
      startingLiquidity: first.startingLiquidity,
      endingLiquidity: last.endingLiquidity,
      totalInflow: group.reduce((s, r) => s + r.totalInflow, 0),
      totalOutflow: group.reduce((s, r) => s + r.totalOutflow, 0),
      netFlow: group.reduce((s, r) => s + r.netFlow, 0),
      months: group.length,
    };
  });
}

function computeItems(flows: AnyCashFlow[], periodStart: Date, periodEnd: Date): PeriodItem[] {
  const totals = new Map<string, PeriodItem>();
  for (const cf of flows) {
    const amount = cashFlowAmount(cf, periodStart, periodEnd);
    if (amount === 0) {
      continue;
    }
    const absAmount = Math.abs(amount);
    const existing = totals.get(cf.name);
    if (existing) {
      existing.amount += absAmount;
    } else {
      totals.set(cf.name, { name: cf.name, direction: cf.direction, amount: absAmount });
    }
  }
  return [...totals.values()].sort((a, b) => {
    const ai = a.direction === Direction.Inflow ? 0 : 1;
    const bi = b.direction === Direction.Inflow ? 0 : 1;
    if (ai !== bi) {
      return ai - bi;
    }
    return b.amount - a.amount;
  });
}

function checkInvariant(
  items: PeriodItem[],
  startingLiquidity: number,
  endingLiquidity: number,
  periodStart: Date,
  periodEnd: Date
): void {
  const netItems = items.reduce(
    (s, i) => s + (i.direction === Direction.Inflow ? i.amount : -i.amount),
    0
  );
  const netLedger = endingLiquidity - startingLiquidity;
  if (Math.abs(netItems - netLedger) > 1e-6) {
    throw new EngineError(
      `Invariant violation: items net (${netItems}) ≠ net liquidity change ` +
        `(${netLedger}) in period [${periodStart.toISOString().slice(0, 10)}, ` +
        `${periodEnd.toISOString().slice(0, 10)}]`
    );
  }
}

export function aggregateCashflowsInPeriod(
  cashFlows: AnyCashFlow[],
  actuals: LiquidityActual[],
  periodStart: Date,
  periodEnd: Date
): PeriodSummary {
  if (periodEnd.getTime() < periodStart.getTime()) {
    throw new EngineError(
      `period_end (${periodEnd.toISOString().slice(0, 10)}) must be on or after period_start (${periodStart
        .toISOString()
        .slice(0, 10)})`
    );
  }

  let flows: AnyCashFlow[];
  let seedDate: Date;
  let seedBalance: number;

  if (actuals.length > 0) {
    const latest = latestActual(actuals);
    seedDate = latest.date;
    seedBalance = latest.amount;
    flows = cashFlows.filter(
      (cf) => !(cf instanceof OneOffCashFlow && cf.date.getTime() < latest.date.getTime())
    );
  } else {
    seedDate = periodStart;
    seedBalance = 0;
    flows = cashFlows;
  }

  const startingLiquidity = balanceAt(flows, addDays(periodStart, -1), seedDate, seedBalance);
  const items = computeItems(flows, periodStart, periodEnd);

  const netItems = items.reduce(
    (s, i) => s + (i.direction === Direction.Inflow ? i.amount : -i.amount),
    0
  );
  const endingLiquidity = startingLiquidity + netItems;

  checkInvariant(items, startingLiquidity, endingLiquidity, periodStart, periodEnd);

  return {
    startingLiquidity,
    endingLiquidity,
    items,
    periodStart,
    periodEnd,
  };
}
