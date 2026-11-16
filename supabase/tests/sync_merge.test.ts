/*
 * v1.2.4 sync findings SYNC-08 (set merges for exdates and tags) and SYNC-16 (pushes outside shares
 * don't queue on the global lock). Run with `npm run test:server`.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { list, push, row, rpc, send, task, uid, user } from "./helpers";

const arr = (v: unknown) => JSON.parse(String(v)) as unknown[];

describe("SYNC-08: two devices edit the same set-like column", () => {
  it("keeps both devices' skipped dates and tags, and the pusher's removals", async () => {
    const u = await user();
    const [d1, d2] = [randomUUID(), randomUUID()];
    const l = uid(), t = uid();
    await push(u.db, d1, [
      { seq: 1, ...list(l) },
      { seq: 2, ...task(t, l, { exdates: '["2026-11-01"]', tags: '["a","b"]' }) },
    ]);
    // Both offline from the same state: d1 skips the 3rd and drops tag a, d2 skips the 5th and adds tag c.
    await push(u.db, d1, [{ seq: 3, tbl: "tasks", id: t, fields: { exdates: '["2026-11-01","2026-11-03"]', _add_exdates: ["2026-11-03"], _del_exdates: [], tags: '["b"]', _add_tags: [], _del_tags: ["a"] } }]);
    await push(u.db, d2, [{ seq: 1, tbl: "tasks", id: t, fields: { exdates: '["2026-11-01","2026-11-05"]', _add_exdates: ["2026-11-05"], _del_exdates: [], tags: '["a","b","c"]', _add_tags: ["c"], _del_tags: [] } }]);
    const r = await row(u.db, "tasks", t);
    expect(arr(r?.exdates)).toEqual(["2026-11-01", "2026-11-05", "2026-11-03"]);
    expect(arr(r?.tags)).toEqual(["b", "c"]);
    expect(r).not.toHaveProperty("_add_tags");
    expect(r).not.toHaveProperty("_del_exdates");
  });

  it("still replaces the value for a patch without deltas (older apps)", async () => {
    const u = await user();
    const l = uid(), t = uid();
    await send(u.db, list(l), task(t, l, { tags: '["a"]' }));
    await send(u.db, { tbl: "tasks", id: t, fields: { tags: '["z"]' } });
    expect(arr((await row(u.db, "tasks", t))?.tags)).toEqual(["z"]);
  });

  it("merges a member's tags on a shared task in their personal layer", async () => {
    const [o, m] = await Promise.all([user(), user()]);
    const l = uid(), t = uid();
    await send(o.db, list(l), task(t, l));
    await rpc(m.db, "redeem_invite", { p_code: await rpc<string>(o.db, "create_share_invite", { p_share: await rpc<string>(o.db, "create_share", { p_kind: "list", p_container: l }), p_role: "editor" }) });
    const [d1, d2] = [randomUUID(), randomUUID()];
    await push(m.db, d1, [{ seq: 1, tbl: "tasks", id: t, fields: { tags: '["x"]', _add_tags: ["x"], _del_tags: [] } }]);
    await push(m.db, d2, [{ seq: 1, tbl: "tasks", id: t, fields: { tags: '["y"]', _add_tags: ["y"], _del_tags: [] } }]);
    expect(arr((await row(m.db, "tasks", t))?.tags)).toEqual(["y", "x"]);
    expect(arr((await row(o.db, "tasks", t))?.tags)).toEqual([]);
  });
});

describe("SYNC-16: accounts outside every share", () => {
  it("push side by side with each other and with a share's members, and nothing is lost", async () => {
    const people = await Promise.all([user(), user(), user(), user()]);
    const [o, m] = await Promise.all([user(), user()]);
    const l = uid();
    await send(o.db, list(l));
    await rpc(m.db, "redeem_invite", { p_code: await rpc<string>(o.db, "create_share_invite", { p_share: await rpc<string>(o.db, "create_share", { p_kind: "list", p_container: l }), p_role: "editor" }) });
    const ids = people.map(() => uid());
    const shared = [uid(), uid()];
    const results = await Promise.all([
      ...people.map((p, i) => send(p.db, list(ids[i]), task(uid(), ids[i]))),
      send(o.db, task(shared[0], l)),
      send(m.db, task(shared[1], l)),
    ]);
    for (const r of results) expect(r.refused).toEqual([]);
    for (const [i, p] of people.entries()) expect(await row(p.db, "lists", ids[i])).toBeDefined();
    for (const t of shared) expect(await row(o.db, "tasks", t)).toBeDefined();
  });
});
