/*
 * Sync simulation for shares (PLAN D162, v1.4 Verification): an owner, an editor, a viewer and a
 * list-only member make random edits, creates, moves across the boundary, sent tasks and
 * membership changes, pushing and pulling at random. Each keeps a replica the way a device does
 * (cursor pulls, field merges, tombstones that cascade like the local foreign keys). At the end:
 * every replica equals a fresh full pull, and holds exactly the tasks the server says it may see.
 * A failing seed is a regression case: add it to SEEDS.
 */
import { describe, expect, it } from "vitest";
import { admin, rpc, send, uid, user, type Remote, type User } from "./helpers";

const SEEDS = (process.env.SIM_SEEDS ?? "1,2,3").split(",").map(Number);
const STEPS = 120;

function prng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

type Rows = Map<string, Record<string, unknown>>;
const canon = (r: Record<string, unknown> | undefined) => (r ? JSON.stringify(Object.entries(r).sort(([a], [b]) => a.localeCompare(b))) : "none");

/** Applies pulled rows like a device: merge fields, drop rows it can't insert, cascade deletes. */
function apply(rows: Rows, pulled: Remote[]) {
  for (const r of pulled) {
    const key = `${r.tbl}/${r.id}`;
    if (r.data.deleted_at) {
      rows.delete(key);
      if (r.tbl === "lists") for (const [k, v] of rows) if (k.startsWith("tasks/") && v.list_id === r.id) rows.delete(k);
      if (r.tbl === "tasks") for (const [k, v] of rows) if (k.startsWith("tasks/") && v.parent_id === r.id) rows.delete(k);
      continue;
    }
    const have = rows.get(key);
    if (!have && r.tbl === "tasks" && typeof r.data.title !== "string") continue; // a personal-layer patch for a task it doesn't hold
    rows.set(key, { ...(have ?? {}), ...r.data });
  }
}

class Device {
  rows: Rows = new Map();
  cursor = 0;
  constructor(readonly u: User) {}
  async pull() {
    for (;;) {
      const { data, error } = await this.u.db.rpc("sync_pull", { p_cursor: this.cursor });
      if (error) throw error;
      const page = data as Remote[];
      apply(this.rows, page);
      if (page.length) this.cursor = page.at(-1)!.version;
      if (page.length < 1000) return;
    }
  }
  tasks = () => [...this.rows.entries()].filter(([k]) => k.startsWith("tasks/")).map(([k, v]) => ({ id: k.slice(6), ...v }));
  lists = () => [...this.rows.entries()].filter(([k]) => k.startsWith("lists/")).map(([k]) => k.slice(6));
}

async function fresh(u: User): Promise<Rows> {
  const d = new Device(u);
  await d.pull();
  return d.rows;
}

describe.each(SEEDS)("simulation, seed %i", (seed) => {
  it("converges and never shows a task outside its access", async () => {
    const rnd = prng(seed);
    const pick = <T>(xs: T[]): T | undefined => xs[Math.floor(rnd() * xs.length)];
    const [O, E, V, L] = await Promise.all([user(), user(), user(), user()]);
    const F = uid(), A = uid(), B = uid(), personal = { [O.id]: uid(), [E.id]: uid(), [V.id]: uid(), [L.id]: uid() };
    await send(O.db,
      { tbl: "folders", id: F, fields: { id: F, name: "F", parent_id: null, deleted_at: null } },
      { tbl: "lists", id: A, fields: { id: A, name: "A", folder_id: F, deleted_at: null } },
      { tbl: "lists", id: B, fields: { id: B, name: "B", folder_id: F, deleted_at: null } });
    for (const u of [O, E, V, L]) await send(u.db, { tbl: "lists", id: personal[u.id], fields: { id: personal[u.id], name: "mine", folder_id: null, deleted_at: null } });
    const shareF = await rpc<string>(O.db, "create_share", { p_kind: "folder", p_container: F });
    const shareA = await rpc<string>(O.db, "create_share", { p_kind: "list", p_container: A });
    const join = async (share: string, u: User, role: string) =>
      rpc(u.db, "redeem_invite", { p_code: await rpc<string>(O.db, "create_share_invite", { p_share: share, p_role: role }) });
    await join(shareF, E, "editor");
    await join(shareF, V, "viewer");
    await join(shareA, L, "editor");
    for (const x of [E, V, L]) await rpc(x.db, "redeem_invite", { p_code: await rpc<string>(O.db, "create_friend_invite") });

    const devices = [O, E, V, L].map((u) => new Device(u));
    const who = (d: { u: User }) => ["O", "E", "V", "L"][[O, E, V, L].indexOf(d.u)];
    const name = (l: string) => (l === A ? "A" : l === B ? "B" : Object.values(personal).includes(l) ? `mine(${who({ u: [O, E, V, L].find((u) => personal[u.id] === l)! })})` : l);
    for (const d of devices) await d.pull();
    const ops: string[] = [];

    for (let step = 0; step < STEPS; step++) {
      const d = pick(devices)!;
      const r = rnd();
      const visible = d.tasks().filter((t) => t.deleted_at == null);
      const t = pick(visible);
      const lists = d.lists();
      try {
        if (r < 0.25) {
          const l = pick([...lists, personal[d.u.id]])!;
          const id = uid();
          await send(d.u.db, { tbl: "tasks", id, fields: { id, title: `t${step}`, list_id: l, status: "open", tags: "[]", reminders: "[]", pinned: 0, deleted_at: null } });
          ops.push(`${step} ${who(d)} create ${id} in ${name(l)}`);
        } else if (r < 0.45 && t) {
          await send(d.u.db, { tbl: "tasks", id: t.id, fields: { title: `edit${step}`, ...(rnd() < 0.3 ? { tags: `["s${step}"]` } : {}) } });
          ops.push(`${step} ${who(d)} edit ${t.id}`);
        } else if (r < 0.6 && t) {
          const to = pick([A, B, personal[d.u.id]])!;
          await send(d.u.db, { tbl: "tasks", id: t.id, fields: { list_id: to } });
          ops.push(`${step} ${who(d)} move ${t.id} to ${name(to)}`);
        } else if (r < 0.68 && t) {
          await send(d.u.db, { tbl: "tasks", id: t.id, fields: { status: rnd() < 0.5 ? "done" : "open" } });
        } else if (r < 0.72 && t) {
          await send(d.u.db, { tbl: "tasks", id: t.id, fields: { deleted_at: new Date().toISOString() } });
          ops.push(`${step} ${who(d)} delete ${t.id}`);
        } else if (r < 0.8) {
          // The owner changes membership.
          const who_ = pick([E, V, L])!;
          const share = who_ === L ? shareA : shareF;
          const c = rnd();
          if (c < 0.4) await rpc(O.db, "remove_member", { p_share: share, p_account: who_.id }).catch(() => undefined);
          else await join(share, who_, c < 0.7 ? "editor" : "viewer").catch(() => undefined);
          if (c >= 0.4) await rpc(O.db, "set_member_role", { p_share: share, p_account: who_.id, p_role: c < 0.7 ? "editor" : "viewer" }).catch(() => undefined);
          ops.push(`${step} membership ${who({ u: who_ })} ${c < 0.4 ? "remove" : c < 0.7 ? "editor" : "viewer"}`);
        } else if (r < 0.84) {
          const to = pick(devices.filter((x) => x !== d))!;
          const { data: sid } = await admin().rpc("send_task", { p_sender: d.u.id, p_recipient: to.u.id, p_payload: { title: `sent${step}` } });
          if (sid) await rpc(to.u.db, "respond_sent_task", { p_id: sid, p_accept: rnd() < 0.7 });
        }
      } catch {
        // Refusals between friends who aren't (O is everyone's friend, the others aren't) are expected.
      }
      if (rnd() < 0.5) { const p = pick(devices)!; await p.pull(); ops.push(`${step} ${who(p)} pull`); }
    }

    for (const d of devices) await d.pull();
    for (const d of devices) {
      // Incremental sync ends where a fresh full pull does.
      const full = await fresh(d.u);
      const strip = (m: Rows) => [...m.entries()].filter(([k]) => k.startsWith("tasks/") || k.startsWith("lists/")).sort(([a], [b]) => a.localeCompare(b));
      const diff = (a: Rows, b: Rows) => [...a.keys()].filter((k) => (k.startsWith("tasks/") || k.startsWith("lists/")) && canon(a.get(k)) !== canon(b.get(k)));
      const fields = (k: string) => {
        const a = d.rows.get(k) ?? {}, b = full.get(k) ?? {};
        return [k, Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].filter((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f])).map((f) => [f, [a[f], b[f]]]))];
      };
      expect({ onlyIncremental: diff(d.rows, full).map(fields), onlyFull: diff(full, d.rows).map(fields) },
        `seed ${seed} account ${[O, E, V, L].indexOf(d.u)}`).toEqual({ onlyIncremental: [], onlyFull: [] });
      // And holds exactly the live tasks the server says the account may see.
      const { data: server } = await admin().from("sync_rows").select("owner_id, id, data").eq("tbl", "tasks").in("owner_id", [O.id, E.id, V.id, L.id]);
      const may: string[] = [];
      for (const s of server ?? []) {
        if ((s.data as { deleted_at?: unknown }).deleted_at) continue;
        const { data: role } = await admin().rpc("row_role", { p_owner: s.owner_id, p_tbl: "tasks", p_id: s.id, p_data: s.data, p_account: d.u.id });
        if (role) may.push(s.id);
      }
      const held = d.tasks().map((t) => t.id);
      const bad = may.filter((x) => !held.includes(x)).concat(held.filter((x) => !may.includes(x)));
      if (bad.length) console.log([`seed ${seed} ${who(d)} bad ${bad}`, ...ops.filter((o) => bad.some((b) => o.includes(b)) || o.includes("membership") || o.includes(`${who(d)} pull`))].join(String.fromCharCode(10)));
      expect({ extra: held.filter((x) => !may.includes(x)), missing: may.filter((x) => !held.includes(x)).map((x) => [x, (server ?? []).find((s) => s.id === x)?.data]) },
        `seed ${seed} account ${[O, E, V, L].indexOf(d.u)}`).toEqual({ extra: [], missing: [] });
    }
  }, 180_000);
});
