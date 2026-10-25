import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tauri needs a fixed port and visible Rust errors.
  clearScreen: false,
  // Desktop app loading from local disk: one ~650 kB chunk is fine, no need to split.
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // Pinned zone with DST so date/recurrence tests are deterministic on any machine.
  test: { include: ["src/**/*.test.ts"], env: { TZ: "America/New_York" } },
});
