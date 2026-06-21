import { useMemo, useState } from "react";
import { combinedMonthlyChart, monthYearLabel, periodWaterfallChart } from "../charts";
import { civilDate, formatISO } from "../dates";
import {
  type PeriodSummary,
  aggregateCashflowsInPeriod,
  buildTimeline,
  computeLedger,
} from "../engine";
import { formatGBP } from "../format";
import type { ParsedInputs } from "../ingest";
import { BudgeteerError } from "../models";
import { PlotlyChart } from "./PlotlyChart";

type Tab = "monthly" | "waterfall" | "ledger";
type WfMode = "phase" | "month" | "custom";

function parseIso(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return civilDate(y ?? 1970, m ?? 1, d ?? 1);
}

export function Dashboard({
  inputs,
  onReset,
  onRefresh,
}: {
  inputs: ParsedInputs;
  onReset: () => void;
  onRefresh?: () => void;
}) {
  const { phases, cashFlows, actuals } = inputs;
  const timeline = useMemo(() => buildTimeline(phases), [phases]);
  const ledger = useMemo(
    () => computeLedger(timeline, phases, cashFlows, actuals.length > 0 ? actuals : null),
    [timeline, phases, cashFlows, actuals]
  );

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
    () => combinedMonthlyChart(ledger, actuals.length > 0 ? actuals : null),
    [ledger, actuals]
  );

  let waterfall: { summary: PeriodSummary } | { error: string };
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
    waterfall = {
      summary: aggregateCashflowsInPeriod(timeline, phases, cashFlows, start, end, actuals),
    };
  } catch (e) {
    waterfall = { error: e instanceof Error ? e.message : String(e) };
  }

  return (
    <div className="layout">
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
        <button type="button" className="reset" onClick={onReset}>
          Load another source
        </button>
      </aside>

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
          <button type="button" aria-pressed={tab === "ledger"} onClick={() => setTab("ledger")}>
            Ledger Data
          </button>
        </nav>

        {tab === "monthly" && (
          <section>
            <PlotlyChart figure={monthlyFigure} onPointClick={drillToMonth} />
            <p className="hint">Click any bar or marker to drill into that month's waterfall.</p>
          </section>
        )}

        {tab === "waterfall" && (
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
            )}

            {wfMode === "month" && (
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
            )}

            {wfMode === "custom" && (
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
            )}

            {"error" in waterfall ? (
              <p className="error">Period error: {waterfall.error}</p>
            ) : (
              <PlotlyChart figure={periodWaterfallChart(waterfall.summary)} />
            )}
          </section>
        )}

        {tab === "ledger" && (
          <section>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Starting</th>
                  <th>Inflow</th>
                  <th>Outflow</th>
                  <th>Net</th>
                  <th>Ending</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((row) => (
                  <tr key={formatISO(row.monthYear)}>
                    <td>{monthYearLabel(row.monthYear)}</td>
                    <td>{formatGBP(row.startingLiquidity)}</td>
                    <td>{formatGBP(row.totalInflow)}</td>
                    <td>{formatGBP(row.totalOutflow)}</td>
                    <td>{formatGBP(row.netFlow)}</td>
                    <td>{formatGBP(row.endingLiquidity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  );
}
