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
export const ANNUAL_PERIOD_DAYS = 365.25;

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
  if (cf instanceof OneOffCashFlow) {
    return year(m) === year(cf.date) && month(m) === month(cf.date) ? 1.0 : 0.0;
  }

  if (cf.frequency === Frequency.Monthly) {
    const monthBegin = fromDate ?? m;
    const monthFinish = monthEnd(m);
    const days = intervalOverlapDays(cf.startDate, cf.endDate, monthBegin, monthFinish);
    return days / MONTHLY_PERIOD_DAYS;
  }

  const anchorM = cf.startDate ? month(cf.startDate) : 1;
  const anchorD = cf.startDate ? day(cf.startDate) : 1;
  if (month(m) !== anchorM) {
    return 0.0;
  }
  const windowStart = anchorDate(year(m), anchorM, anchorD);
  const windowEnd = addDays(anchorDate(year(m) + 1, anchorM, anchorD), -1);
  const effectiveStart = fromDate ? maxDate(windowStart, fromDate) : windowStart;
  const days = intervalOverlapDays(cf.startDate, cf.endDate, effectiveStart, windowEnd);
  return days / ANNUAL_PERIOD_DAYS;
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

export function aggregateCashflowsInPeriod(
  timeline: Date[],
  phases: Phase[],
  cashFlows: AnyCashFlow[],
  periodStart: Date,
  periodEnd: Date,
  actuals: LiquidityActual[] | null = null
): PeriodSummary {
  if (periodEnd.getTime() < periodStart.getTime()) {
    throw new EngineError(
      `period_end (${periodEnd.toISOString().slice(0, 10)}) must be on or after period_start (${periodStart
        .toISOString()
        .slice(0, 10)})`
    );
  }

  const ledger = computeLedger(timeline, phases, cashFlows, actuals);
  const startMonth = monthStart(periodStart);
  const endMonth = monthStart(periodEnd);

  const inPeriod = ledger.filter(
    (r) =>
      r.monthYear.getTime() >= startMonth.getTime() && r.monthYear.getTime() <= endMonth.getTime()
  );
  if (inPeriod.length === 0) {
    throw new EngineError(
      `Period [${periodStart.toISOString().slice(0, 10)}, ${periodEnd
        .toISOString()
        .slice(0, 10)}] does not overlap the forecast timeline`
    );
  }

  const startingLiquidity = (inPeriod[0] as LedgerRow).startingLiquidity;
  const endingLiquidity = (inPeriod.at(-1) as LedgerRow).endingLiquidity;

  const months = timeline.filter(
    (m) => m.getTime() >= startMonth.getTime() && m.getTime() <= endMonth.getTime()
  );

  const totals = new Map<string, PeriodItem>();
  for (const cf of cashFlows) {
    let amount = 0;
    for (const m of months) {
      amount += cf.amount * activeFraction(cf, m);
    }
    if (amount === 0) {
      continue;
    }
    const existing = totals.get(cf.name);
    if (existing) {
      existing.amount += amount;
    } else {
      totals.set(cf.name, { name: cf.name, direction: cf.direction, amount });
    }
  }

  const items = [...totals.values()].sort((a, b) => {
    const ai = a.direction === Direction.Inflow ? 0 : 1;
    const bi = b.direction === Direction.Inflow ? 0 : 1;
    if (ai !== bi) {
      return ai - bi;
    }
    return b.amount - a.amount;
  });

  return {
    startingLiquidity,
    endingLiquidity,
    items,
    periodStart: startMonth,
    periodEnd: endMonth,
  };
}
