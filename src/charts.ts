/**
 * Plotly figure builders, ported from budgeteer/charts.py.
 *
 * These are pure functions returning plain Plotly figure objects (data + layout),
 * so they can be unit-tested without a browser. A thin React wrapper renders them
 * with plotly.js. Phase bands, the zero line and the actuals overlay are encoded
 * as layout shapes/annotations (the JS equivalent of add_vrect/add_hline/add_shape).
 */
import { addMonths, civilDate, formatISO, month, monthEnd, year } from "./dates";
import type { LedgerRow, PeriodSummary } from "./engine";
import { Direction, type LiquidityActual } from "./models";

export interface ChartTrace {
  type: string;
  yaxis?: string;
  measure?: string[];
  [key: string]: unknown;
}

export interface ChartFigure {
  data: ChartTrace[];
  layout: Record<string, unknown>;
}

const PHASE_COLORS = [
  "rgba(99, 110, 250, 0.1)",
  "rgba(239, 85, 59, 0.1)",
  "rgba(0, 204, 150, 0.1)",
  "rgba(171, 99, 250, 0.1)",
  "rgba(255, 161, 90, 0.1)",
  "rgba(25, 211, 243, 0.1)",
];

const PHASE_BORDER_COLORS = [
  "rgba(99, 110, 250, 0.4)",
  "rgba(239, 85, 59, 0.4)",
  "rgba(0, 204, 150, 0.4)",
  "rgba(171, 99, 250, 0.4)",
  "rgba(255, 161, 90, 0.4)",
  "rgba(25, 211, 243, 0.4)",
];

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "%b %Y", e.g. "Jun 2026". */
export function monthYearLabel(d: Date): string {
  return `${MONTH_ABBR[month(d) - 1]} ${year(d)}`;
}

interface PhaseBand {
  name: string;
  min: Date;
  max: Date;
}

function phaseBands(ledger: LedgerRow[]): PhaseBand[] {
  const bands = new Map<string, PhaseBand>();
  const order: string[] = [];
  for (const row of ledger) {
    if (row.activePhase === null) {
      continue;
    }
    const existing = bands.get(row.activePhase);
    if (existing) {
      if (row.monthYear.getTime() < existing.min.getTime()) {
        existing.min = row.monthYear;
      }
      if (row.monthYear.getTime() > existing.max.getTime()) {
        existing.max = row.monthYear;
      }
    } else {
      bands.set(row.activePhase, { name: row.activePhase, min: row.monthYear, max: row.monthYear });
      order.push(row.activePhase);
    }
  }
  return order.map((name) => bands.get(name) as PhaseBand);
}

export function combinedMonthlyChart(
  ledger: LedgerRow[],
  actuals: LiquidityActual[] | null = null,
  dark = false,
  modelLedger?: LedgerRow[]
): ChartFigure {
  const x = ledger.map((r) => {
    const d = r.monthYear;
    return formatISO(civilDate(year(d), month(d), 15));
  });
  const xEnd = ledger.map((r) => formatISO(monthEnd(r.monthYear)));
  const barColors = ledger.map((r) => (r.netFlow >= 0 ? "#2ecc71" : "#e74c3c"));

  const data: ChartTrace[] = [
    {
      type: "bar",
      x,
      y: ledger.map((r) => r.netFlow),
      width: 28 * 86_400_000,
      marker: { color: barColors },
      name: "Net Flow",
    },
    {
      type: "scatter",
      x: xEnd,
      y: ledger.map((r) => r.endingLiquidity),
      mode: "lines+markers",
      name: "Extrapolated",
      line: { color: "#636EFA", width: 2 },
      marker: { size: 5 },
    },
  ];

  const shapes: Record<string, unknown>[] = [
    {
      type: "line",
      xref: "paper",
      x0: 0,
      x1: 1,
      yref: "y",
      y0: 0,
      y1: 0,
      line: { dash: "dash", color: "red", width: 1 },
    },
  ];
  const annotations: Record<string, unknown>[] = [
    {
      xref: "paper",
      x: 1,
      yref: "y",
      y: 0,
      text: "Zero",
      showarrow: false,
      xanchor: "right",
      yanchor: "bottom",
    },
  ];

  phaseBands(ledger).forEach((band, i) => {
    const color = PHASE_COLORS[i % PHASE_COLORS.length] as string;
    const border = PHASE_BORDER_COLORS[i % PHASE_BORDER_COLORS.length] as string;
    shapes.push({
      type: "rect",
      xref: "x",
      x0: formatISO(band.min),
      x1: formatISO(addMonths(band.max, 1)),
      yref: "paper",
      y0: 0,
      y1: 1,
      fillcolor: color,
      line: { width: 1, color: border },
      layer: "below",
    });
    annotations.push({
      xref: "x",
      x: formatISO(band.min),
      yref: "paper",
      y: 1,
      text: band.name,
      showarrow: false,
      xanchor: "left",
      yanchor: "top",
      font: { size: 11 },
    });
  });

  if (actuals && actuals.length > 0) {
    let earliest = actuals[0] as LiquidityActual;
    let latest = actuals[0] as LiquidityActual;
    for (const a of actuals) {
      if (a.date.getTime() < earliest.date.getTime()) {
        earliest = a;
      }
      if (a.date.getTime() > latest.date.getTime()) {
        latest = a;
      }
    }
    const latestIso = formatISO(latest.date);
    shapes.push({
      type: "rect",
      xref: "x",
      x0: formatISO(earliest.date),
      x1: latestIso,
      yref: "paper",
      y0: 0,
      y1: 1,
      fillcolor: "rgba(0, 0, 0, 0.08)",
      line: { width: 0 },
      layer: "below",
    });
    shapes.push({
      type: "line",
      xref: "x",
      x0: latestIso,
      x1: latestIso,
      yref: "paper",
      y0: 0,
      y1: 1,
      line: { dash: "dash", color: "rgba(0, 0, 0, 0.45)", width: 1 },
    });
    annotations.push({
      xref: "x",
      x: latestIso,
      yref: "paper",
      y: 1,
      text: "Latest actual",
      showarrow: false,
      font: { size: 11 },
      xanchor: "right",
      yanchor: "top",
    });
    data.push({
      type: "scatter",
      x: actuals.map((a) => formatISO(a.date)),
      y: actuals.map((a) => a.amount),
      mode: "markers+lines",
      name: "Actual Liquidity",
      marker: { symbol: "diamond", size: 8, color: dark ? "#bbb" : "#2c3e50" },
      line: { color: dark ? "#bbb" : "#2c3e50", width: 1.5 },
    });
  }

  if (modelLedger) {
    data.push({
      type: "scatter",
      x: modelLedger.map((r) => formatISO(monthEnd(r.monthYear))),
      y: modelLedger.map((r) => r.endingLiquidity),
      mode: "lines",
      name: "Modelled",
      line: {
        dash: "dot",
        color: dark ? "rgba(180,180,210,0.5)" : "rgba(99,110,250,0.4)",
        width: 1.5,
      },
    });
  }

  return {
    data,
    layout: {
      title: "Monthly View",
      xaxis: { title: "Month" },
      yaxis: { title: "Amount (£)", tickprefix: "£", tickformat: ",.0f" },
      hovermode: "x unified",
      margin: { t: 60, b: 40, r: 80 },
      legend: { orientation: "v", yanchor: "middle", y: 0.5, xanchor: "left", x: 1.05 },
      shapes,
      annotations,
    },
  };
}

export function periodWaterfallChart(summary: PeriodSummary): ChartFigure {
  const title = `Cashflow Waterfall — ${monthYearLabel(summary.periodStart)} → ${monthYearLabel(summary.periodEnd)}`;

  const labels = ["Starting Liquidity"];
  const values: number[] = [summary.startingLiquidity];
  const measure = ["absolute"];

  for (const item of summary.items) {
    labels.push(item.name);
    values.push(item.direction === Direction.Inflow ? item.amount : -item.amount);
    measure.push("relative");
  }

  labels.push("Ending Liquidity");
  values.push(0);
  measure.push("total");

  return {
    data: [
      {
        type: "waterfall",
        x: labels,
        y: values,
        measure,
        increasing: { marker: { color: "#2ecc71" } },
        decreasing: { marker: { color: "#e74c3c" } },
        totals: { marker: { color: "#636EFA" } },
        connector: { line: { color: "rgba(0,0,0,0.3)" } },
      },
    ],
    layout: {
      title,
      xaxis: { title: "Cash Flow" },
      yaxis: { title: "Amount (£)", tickprefix: "£", tickformat: ",.0f" },
      margin: { t: 60, b: 40 },
    },
  };
}
