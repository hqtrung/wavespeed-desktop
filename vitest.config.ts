import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./electron/__tests__/setup.ts"],
    include: [
      "electron/**/*.{test,spec}.{ts,tsx}",
      "src/**/*.{test,spec}.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: [
        "electron/**/*.{ts,tsx}",
        "src/**/*.{ts,tsx}",
      ],
      exclude: [
        "electron/__tests__/**",
        "src/__tests__/**",
        "src/**/*.{d.ts}",
        "src/workers/**",
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
        perFile: {
          branches: 70,
          functions: 70,
          lines: 70,
          statements: 70,
        },
      },
    },
    outputFile: "./coverage/history-cache-coverage.json",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@/electron": path.resolve(__dirname, "./electron"),
    },
  },
});