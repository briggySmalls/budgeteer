from __future__ import annotations

import time
from datetime import datetime
from pathlib import Path

import streamlit as st

from budgeteer.charts import (
    monthly_net_flow_chart,
    phase_liquidity_chart,
    waterfall_chart,
)
from budgeteer.engine import aggregate_by_phase, build_timeline, compute_ledger
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
    phase_agg = aggregate_by_phase(ledger)

    tab1, tab2, tab3, tab4 = st.tabs(
        ["Liquidity Forecast", "Monthly Net Flow", "Phase Waterfall", "Ledger Data"]
    )

    with tab1:
        st.plotly_chart(phase_liquidity_chart(ledger), theme="streamlit", use_container_width=True)

    with tab2:
        st.plotly_chart(monthly_net_flow_chart(ledger), theme="streamlit", use_container_width=True)

    with tab3:
        st.plotly_chart(
            waterfall_chart(phase_agg, starting_savings),
            theme="streamlit",
            use_container_width=True,
        )

    with tab4:
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
