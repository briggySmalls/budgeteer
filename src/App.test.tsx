import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { ThemeProvider } from "./theme";

afterEach(cleanup);

describe("App", () => {
  it("shows the heading", () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );
    expect(screen.getByRole("heading", { name: /Budgeteer/i })).toBeInTheDocument();
  });

  it("offers Google Sheets before any data is loaded", () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );
    expect(screen.getByRole("button", { name: /Connect Google Sheets/i })).toBeInTheDocument();
  });
});
