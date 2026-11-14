import { execSync } from "node:child_process";

// `supabase status` once for every test file (parallel calls to it are flaky).
export default function setup() {
  process.env.SUPABASE_STATUS_ENV ??= execSync("supabase status -o env", { encoding: "utf8" });
}
