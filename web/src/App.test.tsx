import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";

afterEach(cleanup);

describe("App", () => {
  it("shows the heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /Budgeteer/i })).toBeInTheDocument();
  });

  it("offers both Google Sheets and ODS upload before any data is loaded", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /Connect Google Sheets/i })).toBeInTheDocument();
    expect(screen.getByText(/Upload a/i)).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]');
    expect(input).toHaveAttribute("accept", ".ods");
  });
});
