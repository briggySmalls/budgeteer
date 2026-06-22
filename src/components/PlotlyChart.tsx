import { useEffect, useRef } from "react";
import type { ChartFigure } from "../charts";

type Theme = "light" | "dark";

const PLOT_THEME: Record<
  Theme,
  { paper_bgcolor: string; plot_bgcolor: string; fontColor: string; gridColor: string }
> = {
  light: {
    paper_bgcolor: "#fff",
    plot_bgcolor: "#fff",
    fontColor: "#1a1a2e",
    gridColor: "#e3e3ee",
  },
  dark: {
    paper_bgcolor: "#1a1a2e",
    plot_bgcolor: "#2d2d44",
    fontColor: "#e4e4f0",
    gridColor: "#3d3d5c",
  },
};

interface Props {
  figure: ChartFigure;
  onPointClick?: (isoDate: string) => void;
  height?: number;
}

/**
 * Renders a Plotly figure object. plotly.js is imported dynamically inside the
 * effect so the (large) library never loads at module-eval time — keeping the
 * rest of the app and the jsdom tests free of it.
 */
export function PlotlyChart({ figure, onPointClick, height = 480 }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    let disposed = false;
    let purge: (() => void) | undefined;

    void import("plotly.js-dist-min").then(({ default: Plotly }) => {
      if (disposed) {
        return;
      }
      const theme = (document.documentElement.dataset.theme as Theme) ?? "light";
      const tm = PLOT_THEME[theme] ?? PLOT_THEME.light;

      const layout = {
        ...figure.layout,
        paper_bgcolor: tm.paper_bgcolor,
        plot_bgcolor: tm.plot_bgcolor,
        font: {
          color: tm.fontColor,
          ...(figure.layout.font as Record<string, unknown> | undefined),
        },
        xaxis: {
          gridcolor: tm.gridColor,
          ...(figure.layout.xaxis as Record<string, unknown> | undefined),
        },
        yaxis: {
          gridcolor: tm.gridColor,
          ...(figure.layout.yaxis as Record<string, unknown> | undefined),
        },
      };

      void Plotly.react(el, figure.data, layout, {
        responsive: true,
        displayModeBar: false,
      }).then((plot) => {
        if (onPointClick) {
          plot.on("plotly_click", (event) => {
            const x = event.points?.[0]?.x;
            if (x !== undefined && x !== null) {
              onPointClick(String(x));
            }
          });
        }
      });
      purge = () => Plotly.purge(el);
    });

    return () => {
      disposed = true;
      purge?.();
    };
  }, [figure, onPointClick]);

  return <div ref={ref} style={{ width: "100%", height }} />;
}
