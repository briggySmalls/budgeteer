import { useMemo, useState } from "react";
import { combinedMonthlyChart, monthYearLabel, periodWaterfallChart } from "../charts";
import { civilDate, formatISO } from "../dates";
import { type PeriodSummary, aggregateCashflowsInPeriod, buildTimeline } from "../engine";
import { formatGBP } from "../format";
import type { ParsedInputs } from "../ingest";
import { BudgeteerError } from "../models";
import type { Phase } from "../models";
import type { AnyCashFlow } from "../models";
import type { LiquidityActual } from "../models";
import { useTheme } from "../theme";
import { PlotlyChart } from "./PlotlyChart";

type Tab = "monthly" | "waterfall";
type WfMode = "phase" | "month" | "custom";

function parseIso(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return civilDate(y ?? 1970, m ?? 1, d ?? 1);
}

function WaterfallControls({
  waterfall,
  wfMode,
  setWfMode,
  wfPhase,
  setWfPhase,
  wfMonth,
  setWfMonth,
  rangeFrom,
  setRangeFrom,
  rangeTo,
  setRangeTo,
  phases,
  timeline,
}: {
  waterfall: { summary: PeriodSummary } | { error: string };
  wfMode: WfMode;
  setWfMode: (m: WfMode) => void;
  wfPhase: string;
  setWfPhase: (p: string) => void;
  wfMonth: string;
  setWfMonth: (m: string) => void;
  rangeFrom: string;
  setRangeFrom: (d: string) => void;
  rangeTo: string;
  setRangeTo: (d: string) => void;
  phases: Phase[];
  timeline: Date[];
}) {
  return (
    <section>
      <fieldset className="wf-mode">
        <legend>Period selection</legend>
        {(["phase", "month", "custom"] as const).map((mode) => (
          <label key={mode}>
            <input
              type="radio"
              name="wf-mode"
              checked={wfMode === mode}
              onChange={() => setWfMode(mode)}
            />
            {mode === "phase" ? "Phase" : mode === "month" ? "Single month" : "Custom range"}
          </label>
        ))}
      </fieldset>

      {wfMode === "phase" && (
        <PhaseSelector phases={phases} wfPhase={wfPhase} setWfPhase={setWfPhase} />
      )}

      {wfMode === "month" && (
        <MonthSelector timeline={timeline} wfMonth={wfMonth} setWfMonth={setWfMonth} />
      )}

      {wfMode === "custom" && (
        <CustomRange
          timeline={timeline}
          rangeFrom={rangeFrom}
          setRangeFrom={setRangeFrom}
          rangeTo={rangeTo}
          setRangeTo={setRangeTo}
        />
      )}

      {"error" in waterfall ? (
        <p className="error">Period error: {waterfall.error}</p>
      ) : (
        <PlotlyChart figure={periodWaterfallChart(waterfall.summary)} />
      )}
    </section>
  );
}

function PhaseSelector({
  phases,
  wfPhase,
  setWfPhase,
}: {
  phases: Phase[];
  wfPhase: string;
  setWfPhase: (p: string) => void;
}) {
  return (
    <label className="field">
      Select phase
      <select value={wfPhase} onChange={(e) => setWfPhase(e.target.value)}>
        {phases.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function MonthSelector({
  timeline,
  wfMonth,
  setWfMonth,
}: {
  timeline: Date[];
  wfMonth: string;
  setWfMonth: (m: string) => void;
}) {
  return (
    <label className="field">
      Select month
      <select value={wfMonth} onChange={(e) => setWfMonth(e.target.value)}>
        {timeline.map((m) => (
          <option key={formatISO(m)} value={formatISO(m)}>
            {monthYearLabel(m)}
          </option>
        ))}
      </select>
    </label>
  );
}

function CustomRange({
  timeline,
  rangeFrom,
  setRangeFrom,
  rangeTo,
  setRangeTo,
}: {
  timeline: Date[];
  rangeFrom: string;
  setRangeFrom: (d: string) => void;
  rangeTo: string;
  setRangeTo: (d: string) => void;
}) {
  return (
    <div className="range">
      <label className="field">
        From
        <input
          type="date"
          value={rangeFrom}
          min={formatISO(timeline[0] ?? civilDate(2026, 1, 1))}
          max={formatISO(timeline.at(-1) ?? civilDate(2026, 1, 1))}
          onChange={(e) => setRangeFrom(e.target.value)}
        />
      </label>
      <label className="field">
        To
        <input
          type="date"
          value={rangeTo}
          min={formatISO(timeline[0] ?? civilDate(2026, 1, 1))}
          max={formatISO(timeline.at(-1) ?? civilDate(2026, 1, 1))}
          onChange={(e) => setRangeTo(e.target.value)}
        />
      </label>
    </div>
  );
}

function computeWaterfall(
  cashFlows: AnyCashFlow[],
  actuals: LiquidityActual[],
  phases: Phase[],
  wfMode: WfMode,
  wfPhase: string,
  wfMonth: string,
  rangeFrom: string,
  rangeTo: string
): { summary: PeriodSummary } | { error: string } {
  try {
    let start: Date;
    let end: Date;
    if (wfMode === "phase") {
      const phase = phases.find((p) => p.name === wfPhase) ?? phases[0];
      if (!phase) {
        throw new BudgeteerError("No phase selected");
      }
      start = phase.startDate;
      end = phase.endDate;
    } else if (wfMode === "month") {
      start = parseIso(wfMonth);
      end = parseIso(wfMonth);
    } else {
      start = parseIso(rangeFrom);
      end = parseIso(rangeTo);
    }
    return {
      summary: aggregateCashflowsInPeriod(cashFlows, actuals, start, end),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function DashboardSidebar({
  phases,
  cashFlows,
  latestActual,
  onRefresh,
  onPickAnother,
  onReset,
}: {
  phases: Phase[];
  cashFlows: AnyCashFlow[];
  latestActual: LiquidityActual | null;
  onRefresh?: () => void;
  onPickAnother?: () => void;
  onReset: () => void;
}) {
  return (
    <aside className="sidebar">
      <h2>Model Summary</h2>
      <div className="metric">
        <span className="metric-label">Phases</span>
        <span className="metric-value">{phases.length}</span>
      </div>
      <div className="metric">
        <span className="metric-label">Cash Flows</span>
        <span className="metric-value">{cashFlows.length}</span>
      </div>
      {latestActual && (
        <div className="metric" title={`As of ${formatISO(latestActual.date)}`}>
          <span className="metric-label">Latest Actual</span>
          <span className="metric-value">{formatGBP(latestActual.amount)}</span>
        </div>
      )}
      {onRefresh && (
        <button type="button" className="reset" onClick={onRefresh}>
          Refresh from Sheet
        </button>
      )}
      {onPickAnother && (
        <button type="button" className="reset" onClick={onPickAnother}>
          Choose a different sheet
        </button>
      )}
      <button type="button" className="reset" onClick={onReset}>
        Load another source
      </button>
    </aside>
  );
}

export function Dashboard({
  inputs,
  onReset,
  onRefresh,
  onPickAnother,
}: {
  inputs: ParsedInputs;
  onReset: () => void;
  onRefresh?: () => void;
  onPickAnother?: () => void;
}) {
  const { phases, cashFlows, actuals } = inputs;
  const { theme } = useTheme();
  const dark = theme === "dark";
  const timeline = useMemo(() => buildTimeline(phases), [phases]);

  const [tab, setTab] = useState<Tab>("monthly");
  const [wfMode, setWfMode] = useState<WfMode>("phase");
  const [wfPhase, setWfPhase] = useState(phases[0]?.name ?? "");
  const [wfMonth, setWfMonth] = useState(formatISO(timeline[0] ?? civilDate(2026, 1, 1)));
  const [rangeFrom, setRangeFrom] = useState(formatISO(timeline[0] ?? civilDate(2026, 1, 1)));
  const [rangeTo, setRangeTo] = useState(formatISO(timeline.at(-1) ?? civilDate(2026, 1, 1)));

  const latestActual = actuals.length > 0 ? actuals[actuals.length - 1] : null;

  function drillToMonth(iso: string) {
    setWfMonth(formatISO(parseIso(iso)));
    setWfMode("month");
    setTab("waterfall");
  }

  const monthlyFigure = useMemo(
    () => combinedMonthlyChart(timeline, phases, cashFlows, actuals, dark),
    [timeline, phases, cashFlows, actuals, dark]
  );

  const waterfall = useMemo(
    () => computeWaterfall(cashFlows, actuals, phases, wfMode, wfPhase, wfMonth, rangeFrom, rangeTo),
    [cashFlows, actuals, phases, wfMode, wfPhase, wfMonth, rangeFrom, rangeTo]
  );

  return (
    <div className="layout">
      <DashboardSidebar
        phases={phases}
        cashFlows={cashFlows}
        latestActual={latestActual ?? null}
        onRefresh={onRefresh}
        onPickAnother={onPickAnother}
        onReset={onReset}
      />

      <main className="content">
        <nav className="tabs">
          <button type="button" aria-pressed={tab === "monthly"} onClick={() => setTab("monthly")}>
            Monthly View
          </button>
          <button
            type="button"
            aria-pressed={tab === "waterfall"}
            onClick={() => setTab("waterfall")}
          >
            Period Waterfall
          </button>
        </nav>

        {tab === "monthly" && (
          <section>
            <PlotlyChart figure={monthlyFigure} onPointClick={drillToMonth} />
            <p className="hint">Click any bar or marker to drill into that month's waterfall.</p>
          </section>
        )}

        {tab === "waterfall" && (
          <WaterfallControls
            waterfall={waterfall}
            wfMode={wfMode}
            setWfMode={setWfMode}
            wfPhase={wfPhase}
            setWfPhase={setWfPhase}
            wfMonth={wfMonth}
            setWfMonth={setWfMonth}
            rangeFrom={rangeFrom}
            setRangeFrom={setRangeFrom}
            rangeTo={rangeTo}
            setRangeTo={setRangeTo}
            phases={phases}
            timeline={timeline}
          />
        )}
      </main>
    </div>
  );
}
