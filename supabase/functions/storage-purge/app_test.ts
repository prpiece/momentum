// Deno tests for the storage-purge function: `deno test` in this folder. A fake fetch stands in for PostgREST and Storage.
import { assertEquals } from "jsr:@std/assert@1";
import { handle, type Env } from "./app.ts";

const env: Env = { SUPABASE_URL: "http://fake", SUPABASE_SERVICE_ROLE_KEY: "service", STORAGE_PURGE_SECRET: "cron" };
const call = (method: string, secret?: string, e = env, f: typeof fetch = fetch) =>
  handle(new Request("http://x/storage-purge", { method, headers: secret === undefined ? {} : { "x-cron-secret": secret } }), e, f);

Deno.test("only POST with the right secret gets in", async () => {
  assertEquals((await call("GET", "cron")).status, 405);
  assertEquals((await call("POST", "wrong")).status, 401);
  assertEquals((await call("POST", "")).status, 401);
  assertEquals((await call("POST")).status, 401);
  assertEquals((await call("POST", "cron", { ...env, STORAGE_PURGE_SECRET: "" })).status, 401);
  assertEquals((await call("POST", "", { ...env, STORAGE_PURGE_SECRET: "" })).status, 401);
});

/** A queue of {bucket, name} rows; the Storage API refuses any bucket in `broken` (or any batch holding a name in `badNames`). */
function fake(rows: { bucket: string; name: string }[], broken: string[], badNames: string[] = []) {
  const removedFiles: string[] = [], bumped: string[] = [];
  const queue = rows.map((r) => ({ ...r, queued_at: "2020-01-01T00:00:00.000Z" }));
  const f: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const u = new URL(req.url);
    const json = (b: unknown, status = 200) => Response.json(b, { status });
    if (u.pathname.startsWith("/storage/v1/object/")) {
      const bucket = u.pathname.split("/")[4];
      const { prefixes } = (await req.json()) as { prefixes: string[] };
      if (broken.includes(bucket) || prefixes.some((p) => badNames.includes(p))) return json({ message: "boom" }, 500);
      removedFiles.push(...prefixes.map((p) => `${bucket}/${p}`));
      return json(prefixes.map((name) => ({ name })));
    }
    const eq = (k: string) => u.searchParams.get(k)?.replace(/^eq\./, "");
    const inNames = () => (u.searchParams.get("name") ?? "").replace(/^in\.\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, ""));
    if (req.method === "GET") {
      const before = u.searchParams.get("queued_at")!.replace(/^lt\./, "");
      return json(queue.filter((r) => r.queued_at < before).slice(0, 100));
    }
    const hit = queue.filter((r) => r.bucket === eq("bucket") && inNames().includes(r.name));
    if (req.method === "DELETE") { for (const r of hit) queue.splice(queue.indexOf(r), 1); return new Response(null, { status: 204 }); }
    if (req.method === "PATCH") {
      for (const r of hit) { r.queued_at = new Date(Date.now() + 60_000).toISOString(); bumped.push(`${r.bucket}/${r.name}`); }
      return new Response(null, { status: 204 });
    }
    return json({}, 404);
  };
  return { f, queue, removedFiles, bumped };
}

Deno.test("a failing bucket stays queued and does not stop the others", async () => {
  const s = fake([{ bucket: "attachments", name: "a" }, { bucket: "backups", name: "u/b" }, { bucket: "reports", name: "r/s" }], ["attachments"]);
  const res = await call("POST", "cron", env, s.f);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { removed: 2, failed: 1 });
  assertEquals(s.removedFiles.sort(), ["backups/u/b", "reports/r/s"]);
  assertEquals(s.queue.map((r) => r.name), ["a"]);
  assertEquals(s.bumped, ["attachments/a"]);
});

Deno.test("one bad file does not hold back the rest of its batch", async () => {
  const s = fake([{ bucket: "backups", name: "good1" }, { bucket: "backups", name: "bad" }, { bucket: "backups", name: "good2" }], [], ["bad"]);
  assertEquals(await (await call("POST", "cron", env, s.f)).json(), { removed: 2, failed: 1 });
  assertEquals(s.queue.map((r) => r.name), ["bad"]);
});
