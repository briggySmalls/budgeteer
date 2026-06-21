import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// `base` is set for GitHub Pages project-site hosting; overridden in CI if needed.
export default defineConfig({
  base: "./",
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Coverage gate scoped to the logic core (engine/ingest/models/charts/dates).
      // The React UI is validated end-to-end, not in jsdom (Plotly needs a real DOM).
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/main.tsx",
        "src/**/*.d.ts",
        "src/App.tsx",
        "src/components/**",
        "src/sources/googleAuth.ts",
        "src/sources/googlePicker.ts",
      ],
      thresholds: { lines: 85, statements: 85, functions: 85, branches: 80 },
    },
  },
});
