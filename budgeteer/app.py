from __future__ import annotations

import time
from datetime import date, datetime
from pathlib import Path

import streamlit as st

from budgeteer.charts import combined_monthly_chart, period_waterfall_chart
from budgeteer.engine import aggregate_cashflows_in_period, build_timeline, compute_ledger
from budgeteer.ingest import load_inputs
from budgeteer.models import BudgeteerError

ODS_PATH = Path("model_inputs.ods")


def _get_file_mtime() -> float:
    try:
        return ODS_PATH.stat().st_mtime
    except FileNotFoundError:
        return 0.0


@st.cache_data
def _load_data(mtime: float):
    return load_inputs(ODS_PATH)


@st.fragment(run_every=2)
def _file_watcher():
    current = _get_file_mtime()
    if "last_mtime" not in st.session_state:
        st.session_state.last_mtime = current
    elif current != st.session_state.last_mtime:
        st.session_state.last_mtime = current
        _load_data.clear()
        st.rerun()


def _to_month_start(clicked_x: str | date, timeline: list[date]) -> date:
    """Convert a Plotly-clicked x value (ISO string or date) to the matching timeline month."""
    parsed = date.fromisoformat(clicked_x[:10]) if isinstance(clicked_x, str) else clicked_x
    target = parsed.replace(day=1)
    # Find exact match first, then nearest
    for m in timeline:
        if m == target:
            return m
    return min(timeline, key=lambda m: abs((m - target).days))


def main():
    st.set_page_config(page_title="Budgeteer", layout="wide")
    st.title("Budgeteer — Liquidity Forecast")

    _file_watcher()

    if not ODS_PATH.exists():
        st.warning(f"No `{ODS_PATH}` found. Place a model file in the project root.")
        st.stop()

    mtime = _get_file_mtime()
    try:
        phases, cash_flows, actuals = _load_data(mtime)
    except BudgeteerError as e:
        st.error(f"Data Error: {e}")
        st.stop()
    except PermissionError:
        st.warning("File may be locked by LibreOffice. Retrying...")
        time.sleep(0.5)
        try:
            phases, cash_flows, actuals = _load_data(mtime)
        except Exception as e:
            st.error(f"Could not read file: {e}")
            st.stop()

    with st.sidebar:
        st.header("Model Summary")
        st.metric("Phases", len(phases))
        st.metric("Cash Flows", len(cash_flows))
        if actuals:
            latest_actual = max(actuals, key=lambda a: a.date)
            st.metric(
                "Latest Actual",
                f"£{latest_actual.amount:,.2f}",
                help=f"As of {latest_actual.date}",
            )
        st.caption(f"Last updated: {datetime.fromtimestamp(mtime):%H:%M:%S}")

    timeline = build_timeline(phases)
    ledger = compute_ledger(timeline, phases, cash_flows, actuals or None)

    # Process any pending tab switch from a chart click (must happen before st.tabs is
    # instantiated — Streamlit forbids writing widget state after the widget is rendered).
    if "pending_tab_switch" in st.session_state:
        st.session_state["main_tabs"] = st.session_state.pop("pending_tab_switch")

    tab1, tab2, tab3 = st.tabs(
        ["Monthly View", "Period Waterfall", "Ledger Data"],
        key="main_tabs",
        on_change="rerun",
        default="Monthly View",
    )

    with tab1:
        # Versioned key: incrementing chart_gen on each click forces Streamlit to mount
        # a fresh widget with no retained selection, avoiding greyed traces and phantom
        # re-fires on subsequent reruns.
        chart_key = f"monthly_chart_{st.session_state.get('chart_gen', 0)}"
        event = st.plotly_chart(
            combined_monthly_chart(ledger, actuals or None),
            theme="streamlit",
            use_container_width=True,
            on_select="rerun",
            selection_mode="points",
            key=chart_key,
        )
        st.caption(
            "Click any bar or marker to drill into that month's waterfall. "
            "Click legend entries to toggle traces."
        )

        if event and event.selection.points:
            clicked_month = _to_month_start(event.selection.points[0]["x"], timeline)
            st.session_state["wf_mode"] = "Single month"
            st.session_state["wf_month"] = clicked_month
            st.session_state["pending_tab_switch"] = "Period Waterfall"
            st.session_state["chart_gen"] = st.session_state.get("chart_gen", 0) + 1
            st.rerun()

    with tab2:
        mode = st.radio(
            "Period selection",
            ["Phase", "Single month", "Custom range"],
            horizontal=True,
            key="wf_mode",
        )

        timeline_start = timeline[0]
        timeline_end = timeline[-1]

        if mode == "Phase":
            phase_names = [p.name for p in phases]
            selected_name = st.selectbox("Select phase", phase_names, key="wf_phase")
            selected_phase = next(p for p in phases if p.name == selected_name)
            period_start = selected_phase.start_date
            period_end = selected_phase.end_date

        elif mode == "Single month":
            month_labels = [m.strftime("%b %Y") for m in timeline]
            preset = st.session_state.get("wf_month", timeline_start)
            default_idx = next((i for i, m in enumerate(timeline) if m == preset), 0)
            selected_label = st.selectbox(
                "Select month", month_labels, index=default_idx, key="wf_month_label"
            )
            selected_month = timeline[month_labels.index(selected_label)]
            st.session_state["wf_month"] = selected_month
            period_start = selected_month
            period_end = selected_month

        else:
            col1, col2 = st.columns(2)
            with col1:
                period_start = st.date_input(
                    "From",
                    value=timeline_start,
                    min_value=timeline_start,
                    max_value=timeline_end,
                    key="wf_range_start",
                )
            with col2:
                period_end = st.date_input(
                    "To",
                    value=timeline_end,
                    min_value=timeline_start,
                    max_value=timeline_end,
                    key="wf_range_end",
                )

        try:
            period_summary = aggregate_cashflows_in_period(
                timeline, phases, cash_flows, period_start, period_end, actuals or None
            )
            st.plotly_chart(
                period_waterfall_chart(period_summary),
                theme="streamlit",
                use_container_width=True,
            )
        except BudgeteerError as e:
            st.error(f"Period error: {e}")

    with tab3:
        display = ledger.copy()
        display["month_year"] = display["month_year"].apply(lambda d: d.strftime("%b %Y"))
        for col in [
            "starting_liquidity",
            "total_inflow",
            "total_outflow",
            "net_flow",
            "ending_liquidity",
        ]:
            display[col] = display[col].apply(lambda v: f"£{v:,.2f}")
        st.dataframe(display, use_container_width=True, hide_index=True)


if __name__ == "__main__":
    main()
