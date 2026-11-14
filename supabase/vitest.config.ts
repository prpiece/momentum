import { defineConfig } from "vitest/config";

// Server tests need `supabase start` (Docker); kept out of `npm test`. Files run one at a time:
// some tests change server-wide settings (server_meta) that would break the others mid-run.
export default defineConfig({
  test: { include: ["supabase/tests/**/*.test.ts"], globalSetup: ["supabase/tests/setup.ts"], fileParallelism: false, testTimeout: 20000 },
});
