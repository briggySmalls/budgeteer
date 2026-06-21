declare module "plotly.js-dist-min" {
  export interface PlotlyClickEvent {
    points?: Array<{ x?: unknown; y?: unknown }>;
  }

  export interface PlotlyDiv extends HTMLElement {
    on(event: "plotly_click", handler: (event: PlotlyClickEvent) => void): void;
  }

  const Plotly: {
    react(
      root: HTMLElement,
      data: unknown[],
      layout?: unknown,
      config?: unknown
    ): Promise<PlotlyDiv>;
    newPlot(
      root: HTMLElement,
      data: unknown[],
      layout?: unknown,
      config?: unknown
    ): Promise<PlotlyDiv>;
    purge(root: HTMLElement): void;
  };
  export default Plotly;
}
