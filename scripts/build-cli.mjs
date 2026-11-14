// Builds the `momentum` command line (cli/, D264) and copies it to src-tauri/binaries/momentum-cli-<triple>[.exe],
// where Tauri's bundle.externalBin expects it. Runs before `tauri dev` and `tauri build` (which set
// TAURI_ENV_TARGET_TRIPLE for cross builds). Pass --release for the bundle build.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";

const release = process.argv.includes("--release");
const host = /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))?.[1];
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || host;
const exe = triple.includes("windows") ? ".exe" : "";
const args = ["build", "--manifest-path", "cli/Cargo.toml", "--target", triple, ...(release ? ["--release"] : [])];
execFileSync("cargo", args, { stdio: "inherit" });
mkdirSync("src-tauri/binaries", { recursive: true });
copyFileSync(`cli/target/${triple}/${release ? "release" : "debug"}/momentum-cli${exe}`, `src-tauri/binaries/momentum-cli-${triple}${exe}`);
