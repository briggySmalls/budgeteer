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
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/main.tsx", "src/**/*.d.ts"],
    },
  },
});
