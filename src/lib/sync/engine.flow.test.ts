/*
 * The engine's runs end to end (v1.2.4 findings): real SQLite with the shipped migrations and
 * triggers, the real startSync / syncNow / signOut, and a scripted stand-in for Supabase.
 */
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { numberedParams, setDriver, type Driver } from "../../db/client";

type Handler = (p: { new?: Record<string, unknown>; eventType?: string }) => void;
const sb = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  const chan = {
    on: (_: string, f: { table: string }, h: Handler) => (handlers.set(f.table, h), chan),
    subscribe: () => chan,
  };
  return {
    handlers,
    rpc: (async () => ({ data: null, error: null })) as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>,
    client: {} as Record<string, unknown>,
    chan,
    upserts: [] as { table: string; row: Record<string, unknown> }[],
    upsertError: null as unknown,
  };
});
sb.client.rpc = (name: string, args: Record<string, unknown>) => sb.rpc(name, args);
sb.client.from = (table: string) => ({
  upsert: async (row: Record<string, unknown>) => (sb.upserts.push({ table, row }), { error: sb.upsertError }),
  select: () => ({ maybeSingle: async () => ({ data: null }) }),
  update: () => ({ eq: () => ({ select: async () => ({ data: [{ id: "x" }], error: null }) }) }),
});
sb.client.auth = { getSession: async () => ({ data: { session: {} } }), signOut: async () => ({}) };
sb.client.channel = () => sb.chan;
sb.client.removeChannel = async () => undefined;
vi.mock("./supabase", () => ({ supabase: sb.client, syncConfigured: true, restoreSession: async () => "ok" }));

const engine = await import("./engine");
const { useSettings } = await import("../../stores/settings");

const DIR = "src-tauri/migrations";
let db: DatabaseSync;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  for (const f of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(`${DIR}/${f}`, "utf8"));
  db.exec("PRAGMA foreign_keys = ON");
  const d: Driver = {
    select: async <T,>(sql: string, p: unknown[] = []) => db.prepare(numberedParams(sql)).all(...(p as SQLInputValue[])) as T,
    execute: async (sql, p = []) => ({ rowsAffected: Number(db.prepare(numberedParams(sql)).run(...(p as SQLInputValue[])).changes) }),
  };
  setDriver(async () => d);
  sb.handlers.clear();
  sb.upserts.length = 0;
  sb.upsertError = null;
  sb.rpc = async (name, args) => (name === "sync_push" ? { data: { last_seq: maxSeq(args), refused: [] }, error: null } : { data: [], error: null });
});

const maxSeq = (args: Record<string, unknown>) => Math.max(0, ...(args.p_patches as { seq: number }[]).map((p) => p.seq));
const st = (key: string) => (db.prepare("SELECT value FROM sync_state WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null;
const set = (key: string, value: string) => db.prepare("INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
const at = "2026-11-01T00:00:00.000Z";
const task = (id: string, list = "inbox") => ({ id, title: id, list_id: list, status: "open", priority: 0, sort_order: 0, created_at: at, updated_at: at });
const signedIn = () => {
  set("account", "A");
  set("record", "1");
  set("device_id", "d1");
  set("cursor_schema", String(engine.CLIENT_SCHEMA));
  engine.useSync.setState({ account: "A" });
};
async function stopSync() {
  await engine.syncNow();
  await engine.signOut("keep");
}

describe("SYNC-02: a pull the app died in", () => {
  it("turns recording back on at startup, so local edits reach the outbox", async () => {
    signedIn();
    set("record", "0"); // what a kill between the pull's two state writes leaves
    await engine.startSync();
    await engine.syncNow();
    db.prepare("INSERT INTO tasks (id, title, list_id, status, priority, sort_order, created_at, updated_at) VALUES ('t1', 'x', 'inbox', 'open', 0, 0, ?, ?)").run(at, at);
    expect(count("SELECT count(*) AS n FROM sync_outbox WHERE row_id = 't1'")).toBe(1);
    await stopSync();
  });
});

describe("SYNC-04: sign out and remove data during a sync", () => {
  it("drops the pull that was in flight, so nothing of the old account lands after the wipe", async () => {
    signedIn();
    let release!: (rows: unknown) => void;
    const held = new Promise((r) => (release = r));
    let pulling!: () => void;
    const started = new Promise<void>((r) => (pulling = r));
    sb.rpc = async (name, args) => {
      if (name === "sync_push") return { data: { last_seq: maxSeq(args), refused: [] }, error: null };
      pulling();
      return { data: await held, error: null };
    };
    const run = engine.syncNow();
    await started;
    await engine.signOut("remove");
    release([{ tbl: "lists", id: "secret", version: 7, data: { id: "secret", name: "Secret", sort_order: 1, deleted_at: null } }]);
    await run;
    expect(count("SELECT count(*) AS n FROM lists WHERE id = 'secret'")).toBe(0);
    expect(st("cursor")).toBeNull();
    expect(st("record")).toBe("0");
    expect(engine.useSync.getState()).toMatchObject({ account: null, status: { kind: "off" } });
  });
});

describe("SYNC-05: upgrading across a migration", () => {
  it("pulls everything again once when the cursor was built by an older schema", async () => {
    signedIn();
    set("cursor", "7");
    db.prepare("DELETE FROM sync_state WHERE key = 'cursor_schema'").run(); // built before cursor_schema existed
    const cursors: unknown[] = [];
    sb.rpc = async (name, args) => {
      if (name === "sync_pull") cursors.push(args.p_cursor);
      return name === "sync_push" ? { data: { last_seq: maxSeq(args), refused: [] }, error: null } : { data: [], error: null };
    };
    await engine.startSync();
    await engine.syncNow();
    expect(cursors[0]).toBe(0);
    expect(st("cursor_schema")).toBe(String(engine.CLIENT_SCHEMA));
    await stopSync();
  });

  it("keeps the cursor when the schema hasn't changed", async () => {
    signedIn();
    set("cursor", "7");
    const cursors: unknown[] = [];
    sb.rpc = async (name, args) => {
      if (name === "sync_pull") cursors.push(args.p_cursor);
      return name === "sync_push" ? { data: { last_seq: maxSeq(args), refused: [] }, error: null } : { data: [], error: null };
    };
    await engine.startSync();
    await engine.syncNow();
    expect(cursors[0]).toBe(7);
    await stopSync();
  });
});

it("SYNC-12: CLIENT_SCHEMA is the latest local migration", () => {
  const latest = Math.max(...readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).map((f) => Number(f.slice(0, 4))));
  expect(engine.CLIENT_SCHEMA).toBe(latest);
});

describe("SYNC-06: a copied or restored database", () => {
  it("takes a new device id when the server is ahead of every seq this database made, and pushes again", async () => {
    signedIn();
    db.prepare("INSERT INTO lists (id, name, sort_order) VALUES ('l1', 'Copy', 1)").run();
    const devices: unknown[] = [];
    sb.rpc = async (name, args) => {
      if (name !== "sync_push") return { data: [], error: null };
      devices.push(args.p_device);
      // The original database pushed up to seq 500 under this id after the copy was taken.
      return { data: { last_seq: args.p_device === "d1" ? 500 : maxSeq(args), refused: [] }, error: null };
    };
    await engine.syncNow();
    expect(devices[0]).toBe("d1");
    expect(devices[1]).not.toBe("d1");
    expect(st("device_id")).toBe(devices[1]);
    expect(count("SELECT count(*) AS n FROM sync_outbox")).toBe(0);
  });
});

describe("SYNC-10: a task whose list arrives later", () => {
  it("moves out of the Inbox into its list once the list arrives", async () => {
    signedIn();
    const server: { tbl: string; id: string; version: number; data: Record<string, unknown> }[] = [{ tbl: "tasks", id: "t1", version: 1, data: task("t1", "L") }];
    sb.rpc = async (name, args) =>
      name === "sync_push"
        ? { data: { last_seq: maxSeq(args), refused: [] }, error: null }
        : { data: server.filter((r) => r.version > Number(args.p_cursor)), error: null };
    await engine.syncNow();
    expect(db.prepare("SELECT list_id FROM tasks WHERE id = 't1'").get()).toEqual({ list_id: "inbox" });
    server.push({ tbl: "lists", id: "L", version: 2, data: { id: "L", name: "L", sort_order: 1, deleted_at: null } });
    await engine.syncNow();
    expect(db.prepare("SELECT list_id FROM tasks WHERE id = 't1'").get()).toEqual({ list_id: "L" });
  });
});

describe("SYNC-13: a settings change still waiting on its debounce", () => {
  it("wins over the pulled settings and is pushed", async () => {
    signedIn();
    useSettings.getState().update({ dayEndHour: 3 });
    const pushed: unknown[] = [];
    sb.rpc = async (name, args) => {
      if (name === "sync_push") {
        pushed.push(...(args.p_patches as unknown[]));
        return { data: { last_seq: maxSeq(args), refused: [] }, error: null };
      }
      return { data: Number(args.p_cursor) < 1 ? [{ tbl: "settings", id: "user", version: 1, data: { dayEndHour: 5 } }] : [], error: null };
    };
    await engine.syncNow();
    expect(useSettings.getState().settings.dayEndHour).toBe(3);
    await engine.syncNow();
    expect(pushed).toContainEqual(expect.objectContaining({ tbl: "settings", fields: expect.objectContaining({ dayEndHour: 3 }) }));
  });
});

describe("SYNC-09/15: Realtime wake-ups", () => {
  it("syncs on this account's ping, but not on its own push echo or a device delete", async () => {
    signedIn();
    await engine.startSync();
    await engine.syncNow();
    let pulls = 0;
    sb.rpc = async (name, args) => {
      if (name === "sync_pull") pulls++;
      return name === "sync_push" ? { data: { last_seq: maxSeq(args), refused: [] }, error: null } : { data: [], error: null };
    };
    // SYNC-15: `devices` isn't listened to (nor published) any more.
    expect(sb.handlers.has("devices")).toBe(false);
    sb.handlers.get("sync_pings")?.({ eventType: "UPDATE", new: { account_id: "A", device: "d1" } }); // its own push
    await new Promise((r) => setTimeout(r, 20));
    expect(pulls).toBe(0);
    sb.handlers.get("sync_pings")?.({ eventType: "UPDATE", new: { account_id: "A", device: "d2" } }); // a sibling pushed
    await vi.waitFor(() => expect(pulls).toBe(1));
    sb.handlers.get("sync_pings")?.({ eventType: "UPDATE", new: { account_id: "A", device: null } }); // a server-side change
    await vi.waitFor(() => expect(pulls).toBe(2));
    await stopSync();
  });
});

describe("SYNC-06: the device id kept outside the database file", () => {
  it("takes a new id when the database's id isn't the one this machine keeps, and keeps a matching one", async () => {
    signedIn();
    let kept: string | null = "elsewhere"; // the file was copied from another machine
    engine.setDeviceStore({ get: async () => kept, set: async (id) => void (kept = id) });
    db.prepare("INSERT INTO lists (id, name, sort_order) VALUES ('l1', 'Copy', 1)").run();
    const devices: unknown[] = [];
    sb.rpc = async (name, args) => (name === "sync_push" ? (devices.push(args.p_device), { data: { last_seq: maxSeq(args), refused: [] }, error: null }) : { data: [], error: null });
    await engine.syncNow();
    expect(devices[0]).not.toBe("d1");
    expect(st("device_id")).toBe(devices[0]);
    expect(kept).toBe(devices[0]);

    // Same machine, next launch: the ids match, so it stays.
    engine.setDeviceStore({ get: async () => kept, set: async (id) => void (kept = id) });
    db.prepare("INSERT INTO lists (id, name, sort_order) VALUES ('l2', 'More', 2)").run();
    await engine.syncNow();
    expect(devices[1]).toBe(devices[0]);
    engine.setDeviceStore(null);
  });
});

describe("SYNC-17: a row that failed to apply", () => {
  it("is applied again on later pulls, once what it needs arrives, and reported once", async () => {
    signedIn();
    const server: { tbl: string; id: string; version: number; data: Record<string, unknown> }[] = [
      { tbl: "habit_checkins", id: "h1|2026-11-01", version: 1, data: { habit_id: "h1", date: "2026-11-01", value: 2, deleted_at: null } },
    ];
    sb.rpc = async (name, args) =>
      name === "sync_push"
        ? { data: { last_seq: maxSeq(args), refused: [] }, error: null }
        : { data: server.filter((r) => r.version > Number(args.p_cursor)), error: null };
    await engine.syncNow();
    expect(count("SELECT count(*) AS n FROM habit_checkins")).toBe(0);
    await engine.syncNow(); // still missing: kept, not reported again
    expect(engine.useSync.getState().issues.filter((i) => i.id === "h1|2026-11-01")).toHaveLength(1);
    server.push({ tbl: "habits", id: "h1", version: 2, data: { id: "h1", name: "Run", start_date: "2026-11-01", created_at: at, deleted_at: null } });
    await engine.syncNow();
    expect(db.prepare("SELECT value FROM habit_checkins").all()).toEqual([{ value: 2 }]);
    expect(JSON.parse(st("retry") ?? "[]")).toEqual([]);
  });
});

describe("SYNC-18: sync health", () => {
  it("counts the changes still waiting and remembers the last push", async () => {
    signedIn();
    db.prepare("INSERT INTO lists (id, name, sort_order) VALUES ('l1', 'A', 1)").run();
    sb.rpc = async (name) => (name === "sync_push" ? { data: null, error: new Error("down") } : { data: [], error: null });
    await engine.syncNow();
    expect(engine.useSync.getState().health).toMatchObject({ pending: 1, oldest: expect.any(String) });
    sb.rpc = async (name, args) => (name === "sync_push" ? { data: { last_seq: maxSeq(args), refused: [] }, error: null } : { data: [], error: null });
    await engine.syncNow();
    expect(engine.useSync.getState().health).toMatchObject({ pending: 0, oldest: null, pushedAt: expect.any(String) });
    expect(st("pushed_at")).toBe(engine.useSync.getState().health.pushedAt);
  });
});

describe("SYNC-19/11: the outbox is coalesced, and each patch says when it was edited", () => {
  it("pushes one patch for a run of edits to one task, with each field's edit time", async () => {
    signedIn();
    await engine.startSync();
    await engine.syncNow();
    const sent: { seq: number; fields: Record<string, unknown>; ts: unknown }[] = [];
    sb.rpc = async (name, args) => {
      if (name === "sync_push") sent.push(...(args.p_patches as typeof sent));
      return name === "sync_push" ? { data: { last_seq: maxSeq(args), refused: [] }, error: null } : { data: [], error: null };
    };
    db.prepare("INSERT INTO tasks (id, title, list_id, status, priority, sort_order, created_at, updated_at) VALUES ('t', 't', 'inbox', 'open', 0, 0, ?, ?)").run(at, at);
    db.prepare("UPDATE sync_outbox SET created_at = '2026-11-01T09:00:00.000Z'").run();
    for (let i = 1; i <= 50; i++) db.prepare("UPDATE tasks SET sort_order = ? WHERE id = 't'").run(i);
    db.prepare("UPDATE sync_outbox SET created_at = '2026-11-01T10:00:00.000Z' WHERE json_type(fields, '$.id') IS NULL").run();
    expect(count("SELECT count(*) AS n FROM sync_outbox")).toBe(51);
    await engine.syncNow();
    expect(sent).toHaveLength(1);
    expect(sent[0].fields).toMatchObject({ id: "t", title: "t", sort_order: 50 });
    expect(sent[0].fields).not.toHaveProperty("_ts");
    expect(sent[0].ts).toMatchObject({ title: "2026-11-01T09:00:00.000Z", sort_order: "2026-11-01T10:00:00.000Z" });
    expect(count("SELECT count(*) AS n FROM sync_outbox")).toBe(0);
    await stopSync();
  });

  it("leaves rows a failed push may have delivered alone, and keeps recording compact while signed out (D119)", async () => {
    signedIn();
    await engine.startSync();
    await engine.syncNow();
    db.prepare("INSERT INTO tasks (id, title, list_id, status, priority, sort_order, created_at, updated_at) VALUES ('t', 't', 'inbox', 'open', 0, 0, ?, ?)").run(at, at);
    sb.rpc = async () => ({ data: null, error: new Error("network") });
    await engine.syncNow();
    const sent = Number(st("sent_seq"));
    expect(sent).toBeGreaterThan(0);
    await engine.signOut("keep");
    expect(st("record")).toBe("1");
    for (let i = 1; i <= 20; i++) db.prepare("UPDATE tasks SET title = ? WHERE id = 't'").run(`v${i}`);
    await engine.startSync();
    const rows = db.prepare("SELECT seq, fields FROM sync_outbox ORDER BY seq").all() as { seq: number; fields: string }[];
    expect(rows).toHaveLength(2);
    expect(rows[0].seq).toBe(sent);
    expect(JSON.parse(rows[1].fields)).toMatchObject({ title: "v20" });
  });
});

describe("parent loops already in the database", () => {
  it("are repaired by the first sync of a session even when nothing arrives, once, and pushed", async () => {
    signedIn();
    const ins = db.prepare("INSERT INTO tasks (id, title, list_id, status, priority, sort_order, created_at, updated_at, parent_id) VALUES (?, 'T', 'inbox', 'open', 0, 0, ?, ?, ?)");
    ins.run("x", at, at, null);
    ins.run("y", at, at, "x");
    db.prepare("UPDATE tasks SET parent_id = 'y' WHERE id = 'x'").run();
    db.exec("DELETE FROM sync_outbox");
    const sent: { row_id?: string; fields?: Record<string, unknown> }[] = [];
    sb.rpc = async (name, args) => {
      if (name !== "sync_push") return { data: [], error: null };
      sent.push(...(args.p_patches as typeof sent));
      return { data: { last_seq: maxSeq(args), refused: [] }, error: null };
    };
    await engine.startSync();
    await engine.syncNow();
    expect(db.prepare("SELECT id, parent_id FROM tasks ORDER BY id").all()).toEqual([{ id: "x", parent_id: null }, { id: "y", parent_id: "x" }]);
    expect(JSON.stringify(sent)).toContain("parent_id");
    const n = sent.length;
    await engine.syncNow();
    expect(sent.length).toBe(n);
    await stopSync();
  });
});

describe("repairing parent loops, in the sync run", () => {
  const loop = () => {
    const ins = db.prepare("INSERT INTO tasks (id, title, list_id, status, priority, sort_order, created_at, updated_at, parent_id) VALUES (?, 'T', 'inbox', 'open', 0, 0, ?, ?, ?)");
    ins.run("x", at, at, null);
    ins.run("y", at, at, "x");
    db.prepare("UPDATE tasks SET parent_id = 'y' WHERE id = 'x'").run();
    db.exec("DELETE FROM sync_outbox");
  };
  const parents = () => db.prepare("SELECT id, parent_id FROM tasks ORDER BY id").all();
  it("pushes the break in the same run", async () => {
    signedIn();
    loop();
    const sent: unknown[] = [];
    sb.rpc = async (name, args) => {
      if (name !== "sync_push") return { data: [], error: null };
      sent.push(...(args.p_patches as unknown[]));
      return { data: { last_seq: maxSeq(args), refused: [] }, error: null };
    };
    await engine.syncNow();
    expect(parents()).toEqual([{ id: "x", parent_id: null }, { id: "y", parent_id: "x" }]);
    expect(JSON.stringify(sent)).toContain("parent_id");
    expect(count("SELECT count(*) AS n FROM sync_outbox")).toBe(0);
    await stopSync();
  });
  it("is not marked done for the next account when sign-out lands during an empty pull", async () => {
    signedIn();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let pulling!: () => void;
    const started = new Promise<void>((r) => (pulling = r));
    sb.rpc = async (name, args) => {
      if (name === "sync_push") return { data: { last_seq: maxSeq(args), refused: [] }, error: null };
      pulling();
      await held;
      return { data: [], error: null };
    };
    const run = engine.syncNow();
    await started;
    await engine.signOut("remove");
    release();
    await run;
    sb.rpc = async (name, args) => (name === "sync_push" ? { data: { last_seq: maxSeq(args), refused: [] }, error: null } : { data: [], error: null });
    signedIn();
    loop();
    await engine.syncNow();
    expect(parents()).toEqual([{ id: "x", parent_id: null }, { id: "y", parent_id: "x" }]);
    await stopSync();
  });
});

describe("B4: a push that outlives its account", () => {
  it("sends no patch of the old account after sign-out, even with batches left", async () => {
    signedIn();
    const ins = db.prepare("INSERT INTO tasks (id, title, list_id, status, priority, sort_order, created_at, updated_at) VALUES (?, 'T', 'inbox', 'open', 0, 0, ?, ?)");
    for (let i = 0; i < 700; i++) ins.run(`t${i}`, at, at); // two batches of at most 500
    const calls: string[] = [];
    sb.rpc = async (name, args) => {
      if (name !== "sync_push") return { data: [], error: null };
      calls.push(name);
      await engine.signOut("remove"); // the user switches account while the first batch is on the wire
      return { data: { last_seq: maxSeq(args), refused: [] }, error: null };
    };
    await engine.syncNow();
    expect(calls).toHaveLength(1);
    expect(count("SELECT count(*) AS n FROM sync_outbox")).toBe(0);
  });
});

describe("A7: more failing rows than the retry list holds", () => {
  it("loses none: the cursor waits for the overflow, and every row lands once what it needs arrives", async () => {
    signedIn();
    const N = 650;
    const server: { tbl: string; id: string; version: number; data: Record<string, unknown> }[] = [];
    for (let i = 0; i < N; i++) {
      const date = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
      server.push({ tbl: "habit_checkins", id: `h1|${date}`, version: i + 1, data: { habit_id: "h1", date, value: 1, deleted_at: null } });
    }
    sb.rpc = async (name, args) =>
      name === "sync_push"
        ? { data: { last_seq: maxSeq(args), refused: [] }, error: null }
        : { data: server.filter((r) => r.version > Number(args.p_cursor)), error: null };
    await engine.syncNow(); // no habit h1 yet: every row fails
    expect(count("SELECT count(*) AS n FROM habit_checkins")).toBe(0);
    expect(JSON.parse(st("retry") ?? "[]")).toHaveLength(500);
    expect(Number(st("cursor"))).toBeLessThan(151); // before the oldest dropped row
    await engine.syncNow(); // still failing: no growth, and no new issue per row
    server.push({ tbl: "habits", id: "h1", version: N + 1, data: { id: "h1", name: "Run", start_date: "2025-01-01", created_at: at, deleted_at: null } });
    await engine.syncNow();
    await engine.syncNow();
    expect(count("SELECT count(*) AS n FROM habit_checkins")).toBe(N);
    expect(JSON.parse(st("retry") ?? "[]")).toEqual([]);
    expect(Number(st("cursor"))).toBe(N + 1);
    await stopSync();
  });
});

describe("B6: replaying under a new device id", () => {
  it("never counts a check-in increment twice, and still lands one the server hadn't seen", async () => {
    signedIn();
    db.prepare("INSERT INTO habits (id, name, start_date, created_at) VALUES ('h1', 'Run', '2026-11-01', ?)").run(at);
    db.exec("DELETE FROM sync_outbox");
    const add = db.prepare("INSERT INTO habit_checkins (habit_id, date, value) VALUES ('h1', ?, ?)");
    add.run("2026-11-01", 3); // the original database pushed this one already
    add.run("2026-11-02", 2); // the copy's own edit, which the server never saw
    const server = new Map<string, number>([["h1|2026-11-01", 3]]);
    sb.rpc = async (name, args) => {
      if (name !== "sync_push") return { data: [], error: null };
      // The old device id is "ahead": its seqs are taken, so those patches are skipped.
      if (args.p_device === "d1") return { data: { last_seq: 500, refused: [] }, error: null };
      for (const p of args.p_patches as { id: string; fields: { _delta?: number; value?: number } }[]) {
        if (p.fields._delta != null) server.set(p.id, (server.get(p.id) ?? 0) + p.fields._delta);
        if (p.fields.value != null) server.set(p.id, p.fields.value);
      }
      return { data: { last_seq: maxSeq(args), refused: [] }, error: null };
    };
    await engine.syncNow();
    expect(Object.fromEntries(server)).toEqual({ "h1|2026-11-01": 3, "h1|2026-11-02": 2 });
    expect(count("SELECT count(*) AS n FROM sync_outbox")).toBe(0);
    await stopSync();
  });
});

describe("TIME-04: profiles.time_zone follows the device", () => {
  const zones = () => sb.upserts.filter((u) => u.table === "profiles").map((u) => u.row);
  it("writes the device zone once per launch, retries after a failure, and starts over after sign-out", async () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    signedIn();
    sb.upsertError = { message: "offline" };
    await engine.startSync();
    await engine.syncNow();
    expect(zones().length).toBeGreaterThan(0); // failed: tried
    expect(zones()[0]).toEqual({ id: "A", time_zone: zone });
    sb.upsertError = null;
    await engine.syncNow();
    const n = zones().length;
    await engine.syncNow();
    await engine.syncNow();
    expect(zones()).toHaveLength(n); // written once it succeeded: no write on later syncs
    await engine.signOut("keep");
    signedIn();
    await engine.startSync();
    await engine.syncNow();
    expect(zones().length).toBeGreaterThan(n); // a new sign-in writes again
    await stopSync();
  });

  it("a sign-out during the upsert doesn't mark the zone written for the next account", async () => {
    signedIn();
    await engine.startSync();
    await engine.syncNow();
    await engine.signOut("keep");
    const before = zones().length;
    await engine.syncNow();
    expect(zones()).toHaveLength(before); // signed out: nothing written
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const from = sb.client.from as (t: string) => { upsert: (row: Record<string, unknown>) => Promise<unknown> };
    sb.client.from = (t: string) => ({ ...from(t), upsert: async (row: Record<string, unknown>) => (await gate, from(t).upsert(row)) });
    signedIn();
    sb.upserts.length = 0;
    await engine.startSync();
    const run = engine.syncNow();
    await vi.waitFor(() => expect(engine.useSync.getState().status.kind).toBe("syncing"));
    await new Promise((r) => setTimeout(r, 20));
    const out = engine.signOut("keep"); // lands while the upsert waits
    release();
    await Promise.all([run, out]);
    sb.client.from = from;
    sb.upserts.length = 0;
    signedIn();
    await engine.startSync();
    await engine.syncNow();
    expect(zones().length).toBeGreaterThan(0);
    await stopSync();
  });
});
