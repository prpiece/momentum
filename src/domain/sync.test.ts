import { describe, expect, it } from "vitest";
import { keyFromId, pendingFields, planApply, pushBatches, tagWinner, type OutboxRow, type RemoteRow, type SyncTable } from "./sync";

const COLS = {
  folders: ["id", "name", "parent_id"],
  lists: ["id", "name", "color"],
  tasks: ["id", "title", "list_id", "parent_id", "recurrence_parent_id", "deleted_at"],
  habit_checkins: ["habit_id", "date", "value", "note"],
  rest_days: ["date"],
} as Record<SyncTable, string[]>;

const ob = (seq: number, tbl: string, row_id: string, fields: object): OutboxRow => ({ seq, tbl, row_id, fields: JSON.stringify(fields) });
const rr = (tbl: RemoteRow["tbl"], id: string, data: Record<string, unknown>, version = 1): RemoteRow => ({ tbl, id, data, version });

describe("planApply", () => {
  it("writes remote rows when nothing is pending, dropping unknown columns", () => {
    const ops = planApply([rr("lists", "l1", { id: "l1", name: "Work", color: null, deleted_at: null, future_col: 1 })], new Map(), COLS);
    expect(ops).toEqual([{ kind: "upsert", tbl: "lists", id: "l1", row: { id: "l1", name: "Work", color: null } }]);
  });

  it("keeps fields this device hasn't pushed yet, but takes the rest", () => {
    const pending = pendingFields([ob(1, "lists", "l1", { name: "Mine" })]);
    const ops = planApply([rr("lists", "l1", { id: "l1", name: "Theirs", color: "#fff" })], pending, COLS);
    expect(ops).toEqual([{ kind: "upsert", tbl: "lists", id: "l1", row: { id: "l1", color: "#fff" } }]);
  });

  it("deletes tombstoned rows unless this device has a pending delete or re-create", () => {
    const tomb = { date: "2026-01-01", deleted_at: "2026-01-02T00:00:00.000Z" };
    expect(planApply([rr("rest_days", "2026-01-01", tomb)], new Map(), COLS)).toEqual([{ kind: "delete", tbl: "rest_days", id: "2026-01-01", key: { date: "2026-01-01" } }]);
    const pending = pendingFields([ob(1, "rest_days", "2026-01-01", { date: "2026-01-01", deleted_at: null })]);
    expect(planApply([rr("rest_days", "2026-01-01", tomb)], pending, COLS)).toEqual([]);
  });

  it("treats a pending check-in increment as a pending value, keeping the natural key", () => {
    const pending = pendingFields([ob(1, "habit_checkins", "h|2026-01-01", { _delta: 1 })]);
    const ops = planApply([rr("habit_checkins", "h|2026-01-01", { habit_id: "h", date: "2026-01-01", value: 3, note: "ok" })], pending, COLS);
    expect(ops).toEqual([{ kind: "upsert", tbl: "habit_checkins", id: "h|2026-01-01", row: { habit_id: "h", date: "2026-01-01", note: "ok" } }]);
  });

  it("orders parents before children across and within tables, deletes first", () => {
    const ops = planApply(
      [
        rr("tasks", "child", { id: "child", list_id: "l1", parent_id: "mid" }, 1),
        rr("tasks", "mid", { id: "mid", list_id: "l1", parent_id: "top" }, 2),
        rr("tasks", "top", { id: "top", list_id: "l1", parent_id: null }, 3),
        rr("lists", "l1", { id: "l1", name: "Work" }, 4),
        rr("folders", "f2", { id: "f2", parent_id: "f1" }, 5),
        rr("folders", "f1", { id: "f1", parent_id: null }, 6),
        rr("tasks", "gone", { id: "gone", deleted_at: "2026-01-01T00:00:00.000Z" }, 7),
      ],
      new Map(),
      COLS,
    );
    expect(ops.map((o) => ("id" in o ? o.id : o.kind))).toEqual(["gone", "f1", "f2", "l1", "top", "mid", "child"]);
  });

  it("keeps the newest version when a row appears twice", () => {
    const ops = planApply([rr("lists", "l1", { id: "l1", name: "New" }, 9), rr("lists", "l1", { id: "l1", name: "Old" }, 3)], new Map(), COLS);
    expect(ops).toEqual([{ kind: "upsert", tbl: "lists", id: "l1", row: { id: "l1", name: "New" } }]);
  });

  it("collects user settings, minus pending keys", () => {
    const pending = pendingFields([ob(1, "settings", "user", { theme: "light" })]);
    const ops = planApply([rr("settings", "user", { theme: "dark", weekStart: 0 })], pending, COLS);
    expect(ops).toEqual([{ kind: "settings", fields: { weekStart: 0 } }]);
  });

  it("survives a self-reference cycle in bad data", () => {
    const ops = planApply([rr("tasks", "a", { id: "a", parent_id: "b" }), rr("tasks", "b", { id: "b", parent_id: "a" })], new Map(), COLS);
    expect(ops).toHaveLength(2);
  });
});

describe("pendingFields", () => {
  it("unions fields across patches and skips unreadable ones", () => {
    const p = pendingFields([ob(1, "lists", "l1", { name: "a" }), ob(2, "lists", "l1", { color: "b" }), { seq: 3, tbl: "lists", row_id: "l1", fields: "{bad" }]);
    expect([...(p.get("lists\u0000l1") ?? [])].sort()).toEqual(["color", "name"]);
  });
});

describe("pushBatches", () => {
  it("splits by count and by size", () => {
    const rows = Array.from({ length: 7 }, (_, i) => ob(i, "lists", `l${i}`, { name: "x".repeat(100) }));
    expect(pushBatches(rows, 3).map((b) => b.length)).toEqual([3, 3, 1]);
    expect(pushBatches(rows, 500, 400).every((b) => b.length <= 2)).toBe(true);
    expect(pushBatches([])).toEqual([]);
  });

  it("still sends a single patch bigger than the byte limit, alone", () => {
    const big = ob(1, "tasks", "t", { description: "x".repeat(5000) });
    expect(pushBatches([ob(0, "lists", "l", {}), big, ob(2, "lists", "m", {})], 500, 1000).map((b) => b.length)).toEqual([1, 1, 1]);
  });
});

it("tagWinner picks the same id from either side", () => {
  expect(tagWinner("b", "a")).toBe(tagWinner("a", "b"));
});

it("keyFromId undoes the trigger's row naming", () => {
  expect(keyFromId("habit_checkins", "a|b|2026-01-01")).toEqual({ habit_id: "a|b", date: "2026-01-01" });
  expect(keyFromId("celebrations", "streak-7")).toEqual({ key: "streak-7" });
});
