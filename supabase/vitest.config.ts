import { defineConfig } from "vitest/config";

// Server tests need `supabase start` (Docker); kept out of `npm test`.
export default defineConfig({ test: { include: ["supabase/tests/**/*.test.ts"], testTimeout: 20000 } });
