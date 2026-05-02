from __future__ import annotations

import time
from datetime import datetime
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


def main():
    st.set_page_config(page_title="Budgeteer", layout="wide")
    st.title("Budgeteer — Liquidity Forecast")

    _file_watcher()

    if not ODS_PATH.exists():
        st.warning(
            f"No `{ODS_PATH}` found. Run `make template` to generate one, "
            "or place your own file in the project root."
        )
        st.stop()

    mtime = _get_file_mtime()
    try:
        starting_savings, phases, cash_flows = _load_data(mtime)
    except BudgeteerError as e:
        st.error(f"Data Error: {e}")
        st.stop()
    except PermissionError:
        st.warning("File may be locked by LibreOffice. Retrying...")
        time.sleep(0.5)
        try:
            starting_savings, phases, cash_flows = _load_data(mtime)
        except Exception as e:
            st.error(f"Could not read file: {e}")
            st.stop()

    with st.sidebar:
        st.header("Model Summary")
        st.metric("Starting Savings", f"£{starting_savings:,.2f}")
        st.metric("Phases", len(phases))
        st.metric("Cash Flows", len(cash_flows))
        st.caption(f"Last updated: {datetime.fromtimestamp(mtime):%H:%M:%S}")

    timeline = build_timeline(phases)
    ledger = compute_ledger(timeline, phases, cash_flows, starting_savings)

    tab1, tab2, tab3 = st.tabs(["Monthly View", "Period Waterfall", "Ledger Data"])

    with tab1:
        st.plotly_chart(combined_monthly_chart(ledger), theme="streamlit", use_container_width=True)
        st.caption("Click legend entries to toggle traces. Double-click to isolate.")

    with tab2:
        mode = st.radio(
            "Period selection",
            ["Phase", "Single month", "Custom range"],
            horizontal=True,
        )

        timeline_start = timeline[0]
        timeline_end = timeline[-1]

        if mode == "Phase":
            phase_names = [p.name for p in phases]
            selected_name = st.selectbox("Select phase", phase_names)
            selected_phase = next(p for p in phases if p.name == selected_name)
            period_start = selected_phase.start_date
            period_end = selected_phase.end_date

        elif mode == "Single month":
            month_labels = [m.strftime("%b %Y") for m in timeline]
            selected_label = st.selectbox("Select month", month_labels)
            selected_month = timeline[month_labels.index(selected_label)]
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
                )
            with col2:
                period_end = st.date_input(
                    "To",
                    value=timeline_end,
                    min_value=timeline_start,
                    max_value=timeline_end,
                )

        try:
            period_summary = aggregate_cashflows_in_period(
                timeline, phases, cash_flows, starting_savings, period_start, period_end
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
