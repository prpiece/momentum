import { describe, expect, it } from "vitest";
import { numberedParams, upsert } from "./client";

describe("upsert", () => {
  it("binds every column as a numbered parameter and updates all but the key", () => {
    const [sql, params] = upsert("lists", { id: "l1", name: "Work", color: null });
    expect(sql).toBe("INSERT INTO lists (id, name, color) VALUES ($1, $2, $3) ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color");
    expect(params).toEqual(["l1", "Work", null]);
  });

  it("takes a composite key, and does nothing on conflict when only key columns are given", () => {
    expect(upsert("habit_checkins", { habit_id: "h", date: "2026-01-01", value: 1 }, ["habit_id", "date"])[0]).toContain(
      "ON CONFLICT(habit_id, date) DO UPDATE SET value = excluded.value",
    );
    expect(upsert("rest_days", { date: "2026-01-01" }, ["date"])[0]).toMatch(/ON CONFLICT\(date\) DO NOTHING$/);
  });
});

describe("numberedParams", () => {
  it("rewrites $N to ?N so SQLite binds by number, not by order of appearance", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const sql = numberedParams("SELECT $2 AS b, $1 AS a, $2 AS again");
    expect(sql).toBe("SELECT ?2 AS b, ?1 AS a, ?2 AS again");
    expect(new DatabaseSync(":memory:").prepare(sql).get(1, 2)).toEqual({ b: 2, a: 1, again: 2 });
  });
});
