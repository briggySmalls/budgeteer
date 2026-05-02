from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go

PHASE_COLORS = [
    "rgba(99, 110, 250, 0.1)",
    "rgba(239, 85, 59, 0.1)",
    "rgba(0, 204, 150, 0.1)",
    "rgba(171, 99, 250, 0.1)",
    "rgba(255, 161, 90, 0.1)",
    "rgba(25, 211, 243, 0.1)",
]

PHASE_BORDER_COLORS = [
    "rgba(99, 110, 250, 0.4)",
    "rgba(239, 85, 59, 0.4)",
    "rgba(0, 204, 150, 0.4)",
    "rgba(171, 99, 250, 0.4)",
    "rgba(255, 161, 90, 0.4)",
    "rgba(25, 211, 243, 0.4)",
]


def _add_phase_bands(fig: go.Figure, ledger: pd.DataFrame) -> None:
    phase_col = ledger["active_phase"]
    phases_seen: list[str] = []
    for name in phase_col:
        if pd.notna(name) and name not in phases_seen:
            phases_seen.append(name)

    for i, phase_name in enumerate(phases_seen):
        phase_months = ledger[ledger["active_phase"] == phase_name]["month_year"]
        color_idx = i % len(PHASE_COLORS)
        fig.add_vrect(
            x0=phase_months.min(),
            x1=phase_months.max(),
            fillcolor=PHASE_COLORS[color_idx],
            line_width=1,
            line_color=PHASE_BORDER_COLORS[color_idx],
            annotation_text=phase_name,
            annotation_position="top left",
            annotation_font_size=11,
        )


def combined_monthly_chart(ledger: pd.DataFrame) -> go.Figure:
    bar_colors = ["#2ecc71" if v >= 0 else "#e74c3c" for v in ledger["net_flow"]]

    fig = go.Figure()

    fig.add_trace(
        go.Bar(
            x=ledger["month_year"],
            y=ledger["net_flow"],
            marker_color=bar_colors,
            name="Net Flow",
            yaxis="y",
        )
    )

    fig.add_trace(
        go.Scatter(
            x=ledger["month_year"],
            y=ledger["ending_liquidity"],
            mode="lines+markers",
            name="Ending Liquidity",
            line=dict(color="#636EFA", width=2),
            marker=dict(size=5),
            yaxis="y2",
        )
    )

    fig.add_hline(
        y=0,
        line_dash="dash",
        line_color="red",
        line_width=1,
        annotation_text="Zero",
        annotation_position="bottom right",
    )

    _add_phase_bands(fig, ledger)

    fig.update_layout(
        title="Monthly View",
        xaxis_title="Month",
        yaxis=dict(
            title="Net Flow (£)",
            tickprefix="£",
            tickformat=",.0f",
        ),
        yaxis2=dict(
            title="Liquidity (£)",
            tickprefix="£",
            tickformat=",.0f",
            overlaying="y",
            side="right",
        ),
        hovermode="x unified",
        margin=dict(t=60, b=40),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )

    return fig


def period_waterfall_chart(period_summary: dict) -> go.Figure:
    start = period_summary["period_start"]
    end = period_summary["period_end"]
    title = f"Cashflow Waterfall — {start.strftime('%b %Y')} → {end.strftime('%b %Y')}"

    labels = ["Starting Liquidity"]
    values = [period_summary["starting_liquidity"]]
    measures = ["absolute"]

    for item in period_summary["items"]:
        labels.append(item["name"])
        signed = item["amount"] if item["direction"].value == "Inflow" else -item["amount"]
        values.append(signed)
        measures.append("relative")

    labels.append("Ending Liquidity")
    values.append(0)
    measures.append("total")

    fig = go.Figure(
        go.Waterfall(
            x=labels,
            y=values,
            measure=measures,
            increasing=dict(marker_color="#2ecc71"),
            decreasing=dict(marker_color="#e74c3c"),
            totals=dict(marker_color="#636EFA"),
            connector_line_color="rgba(0,0,0,0.3)",
        )
    )

    fig.update_layout(
        title=title,
        xaxis_title="Cash Flow",
        yaxis_title="Amount (£)",
        yaxis_tickprefix="£",
        yaxis_tickformat=",.0f",
        margin=dict(t=60, b=40),
    )

    return fig
