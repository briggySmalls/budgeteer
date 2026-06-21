import { useEffect, useRef } from "react";
import type { ChartFigure } from "../charts";

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
      void Plotly.react(el, figure.data, figure.layout, {
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
