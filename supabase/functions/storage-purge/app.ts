/*
 * The `storage-purge` Edge Function: removes the Storage files queued in `storage_purge` by
 * purge_deleted() (account deletion). POST with `x-cron-secret`, called by pg_cron. A bucket or file
 * that fails is logged, moved to the back of the queue (queued_at = now) and retried on a later run,
 * so it never blocks the rows behind it.
 */
import { createClient } from "@supabase/supabase-js";

export type Env = Partial<Record<"SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "STORAGE_PURGE_SECRET", string>>;

const BATCH = 100;
const MAX_BATCHES = 20;

function same(a: string, b: string): boolean {
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

export async function handle(req: Request, env: Env, f: typeof fetch = fetch): Promise<Response> {
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405 });
  if (!same(req.headers.get("x-cron-secret") ?? "", env.STORAGE_PURGE_SECRET ?? "")) return Response.json({ error: "bad secret" }, { status: 401 });
  const db = createClient(env.SUPABASE_URL ?? "", env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: f },
  });
  const started = new Date().toISOString();
  let removed = 0, failed = 0;

  /** Removes the names from the bucket and dequeues them; false when the Storage API refused. */
  const drop = async (bucket: string, names: string[]): Promise<boolean> => {
    const rm = await db.storage.from(bucket).remove(names);
    if (rm.error) return false;
    const del = await db.from("storage_purge").delete().eq("bucket", bucket).in("name", names);
    if (del.error) throw del.error;
    removed += names.length;
    return true;
  };

  try {
    for (let i = 0; i < MAX_BATCHES; i++) {
      // Rows bumped by a failure in this run have queued_at > started, so they are not picked again.
      const { data, error } = await db.from("storage_purge").select("bucket, name").lt("queued_at", started).order("queued_at").limit(BATCH);
      if (error) throw error;
      if (!data.length) break;
      for (const bucket of new Set(data.map((r) => r.bucket as string))) {
        const names = data.filter((r) => r.bucket === bucket).map((r) => r.name as string);
        // A bad name fails its whole batch, so retry one by one to drain the good ones.
        let bad: string[] = [];
        if (!(await drop(bucket, names))) {
          for (const n of names) if (!(await drop(bucket, [n]))) bad.push(n);
        }
        if (!bad.length) continue;
        failed += bad.length;
        console.error(`storage-purge: ${bad.length} file(s) in "${bucket}" failed, will retry`);
        const bump = await db.from("storage_purge").update({ queued_at: new Date().toISOString() }).eq("bucket", bucket).in("name", bad);
        if (bump.error) throw bump.error;
      }
    }
  } catch (e) {
    return Response.json({ error: String((e as Error).message ?? e), removed, failed }, { status: 500 });
  }
  return Response.json({ removed, failed });
}
