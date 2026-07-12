/**
 * Plotly figure builders, ported from budgeteer/charts.py.
 *
 * These are pure functions returning plain Plotly figure objects (data + layout),
 * so they can be unit-tested without a browser. A thin React wrapper renders them
 * with plotly.js. Phase bands, the zero line and the actuals overlay are encoded
 * as layout shapes/annotations (the JS equivalent of add_vrect/add_hline/add_shape).
 */
import { addMonths, civilDate, formatISO, month, monthEnd, year } from "./dates";
import { computeLedger } from "./engine";
import type { LedgerRow, PeriodSummary } from "./engine";
import { type AnyCashFlow, Direction, type LiquidityActual, type Phase } from "./models";

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

type Shape = Record<string, unknown>;
type Annotation = Record<string, unknown>;
type Line = Record<string, unknown>;

/** Chart colours, kept in one place so the palette is easy to tweak. */
const CHART = {
  positive: "#2ecc71",
  negative: "#e74c3c",
  brand: "#636EFA",
  zeroLine: "red",
  actualLight: "#2c3e50",
  actualDark: "#bbb",
  modelledLight: "rgba(99,110,250,0.4)",
  modelledDark: "rgba(180,180,210,0.5)",
  connector: "rgba(0,0,0,0.3)",
} as const;

const PHASE_FILL = [0.1, 0.4].map((alpha) => [
  `rgba(99, 110, 250, ${alpha})`,
  `rgba(239, 85, 59, ${alpha})`,
  `rgba(0, 204, 150, ${alpha})`,
  `rgba(171, 99, 250, ${alpha})`,
  `rgba(255, 161, 90, ${alpha})`,
  `rgba(25, 211, 243, ${alpha})`,
]);
const PHASE_COLORS = PHASE_FILL[0] as string[];
const PHASE_BORDER_COLORS = PHASE_FILL[1] as string[];

const MONTH_YEAR_FMT = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "%b %Y", e.g. "Jun 2026". */
export function monthYearLabel(d: Date): string {
  return MONTH_YEAR_FMT.format(d);
}

/** A scatter line trace; `marker` is omitted unless supplied. */
function lineTrace(
  name: string,
  x: string[],
  y: number[],
  mode: string,
  line: Line,
  marker?: Record<string, unknown>
): ChartTrace {
  return { type: "scatter", name, x, y, mode, line, ...(marker ? { marker } : {}) };
}

/** A full-height vertical band (paper-y), drawn below the data. */
function verticalBand(x0: string, x1: string, fillcolor: string, line: Line = { width: 0 }): Shape {
  return {
    type: "rect",
    xref: "x",
    x0,
    x1,
    yref: "paper",
    y0: 0,
    y1: 1,
    fillcolor,
    line,
    layer: "below",
  };
}

interface PhaseBand {
  name: string;
  min: Date;
  max: Date;
}

function upsertBand(
  bands: Map<string, PhaseBand>,
  order: string[],
  name: string,
  date: Date
): void {
  const existing = bands.get(name);
  if (!existing) {
    bands.set(name, { name, min: date, max: date });
    order.push(name);
    return;
  }
  if (date.getTime() < existing.min.getTime()) {
    existing.min = date;
  }
  if (date.getTime() > existing.max.getTime()) {
    existing.max = date;
  }
}

function phaseBands(ledger: LedgerRow[]): PhaseBand[] {
  const bands = new Map<string, PhaseBand>();
  const order: string[] = [];
  for (const row of ledger) {
    if (row.activePhase !== null) {
      upsertBand(bands, order, row.activePhase, row.monthYear);
    }
  }
  return order.map((name) => bands.get(name) as PhaseBand);
}

export function combinedMonthlyChart(
  timeline: Date[],
  phases: Phase[],
  cashFlows: AnyCashFlow[],
  actuals: LiquidityActual[],
  dark = false
): ChartFigure {
  const ledger = computeLedger(timeline, phases, cashFlows, actuals.length > 0 ? actuals : null);
  const modelled =
    actuals.length > 1
      ? computeLedger(timeline, phases, cashFlows, [actuals[0] as LiquidityActual])
      : undefined;

  const xMid = ledger.map((r) => formatISO(civilDate(year(r.monthYear), month(r.monthYear), 15)));
  const xEnd = ledger.map((r) => formatISO(monthEnd(r.monthYear)));
  const barColors = ledger.map((r) => (r.netFlow >= 0 ? CHART.positive : CHART.negative));

  const data: ChartTrace[] = [
    {
      type: "bar",
      x: xMid,
      y: ledger.map((r) => r.netFlow),
      width: 28 * 86_400_000,
      marker: { color: barColors },
      name: "Net Flow",
    },
    lineTrace(
      "Extrapolated",
      xEnd,
      ledger.map((r) => r.endingLiquidity),
      "lines+markers",
      { color: CHART.brand, width: 2 },
      { size: 5 }
    ),
  ];

  const shapes: Shape[] = [
    {
      type: "line",
      xref: "paper",
      x0: 0,
      x1: 1,
      yref: "y",
      y0: 0,
      y1: 0,
      line: { dash: "dash", color: CHART.zeroLine, width: 1 },
    },
  ];
  const annotations: Annotation[] = [
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
    shapes.push(
      verticalBand(formatISO(band.min), formatISO(addMonths(band.max, 1)), color, {
        width: 1,
        color: border,
      })
    );
    annotations.push({
      xref: "x",
      x: formatISO(band.min),
      yref: "paper",
      y: 1 - (i % 3) * 0.06,
      text: band.name,
      showarrow: false,
      font: { size: 11 },
      xanchor: "left",
      yanchor: "top",
    });
  });

  if (actuals && actuals.length > 0) {
    const actualColor = dark ? CHART.actualDark : CHART.actualLight;
    data.push(
      lineTrace(
        "Actual Liquidity",
        actuals.map((a) => formatISO(a.date)),
        actuals.map((a) => a.amount),
        "markers+lines",
        { color: actualColor, width: 1.5 },
        { symbol: "diamond", size: 8, color: actualColor }
      )
    );
  }

  if (modelled) {
    data.push(
      lineTrace(
        "Modelled",
        modelled.map((r) => formatISO(monthEnd(r.monthYear))),
        modelled.map((r) => r.endingLiquidity),
        "lines",
        { dash: "dot", color: dark ? CHART.modelledDark : CHART.modelledLight, width: 1.5 }
      )
    );
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
        increasing: { marker: { color: CHART.positive } },
        decreasing: { marker: { color: CHART.negative } },
        totals: { marker: { color: CHART.brand } },
        connector: { line: { color: CHART.connector } },
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
