import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { eventCountdown } from "../domain/countdown";
import { parseEvent, type Row } from "./rows";

const DIR = "src-tauri/migrations";
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const apply = (db: DatabaseSync, from: number, to: number) => {
  for (const f of files.filter((f) => Number(f.slice(0, 4)) >= from && Number(f.slice(0, 4)) <= to)) db.exec(readFileSync(`${DIR}/${f}`, "utf8"));
};
const at = "2026-01-01T00:00:00.000Z";

describe("0008 countdowns to events", () => {
  it("converts every direction, repeat and icon, then drops the table", () => {
    const db = new DatabaseSync(":memory:");
    apply(db, 1, 7);
    const add = db.prepare("INSERT INTO countdowns (id, title, date, direction, repeat, emoji, color, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    add.run("a", "Trip", "2026-12-25", "until", "none", "hourglass", "#2f6fed", 1, at);
    add.run("b", "Birthday", "1990-03-14", "until", "yearly", "🎂", "#d6457a", 0, at);
    add.run("c", "Rent", "2026-01-31", "until", "monthly", "⏳", "#5b5bd6", 0, at);
    add.run("d", "Sober", "2025-06-01", "since", "none", "gift", "#2f9358", 0, at);
    apply(db, 8, 8);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'countdowns'").all();
    expect(tables).toEqual([]);
    const events = Object.fromEntries(
      (db.prepare("SELECT * FROM calendar_events").all() as Row[]).map(parseEvent).map((e) => [e!.id, e!]),
    );
    expect(Object.keys(events).sort()).toEqual(["a", "b", "c", "d"]);
    expect(events.a).toMatchObject({ title: "Trip", schedule: { kind: "day", date: "2026-12-25" }, spanDays: 1, recurrence: null, countdown: "until", pinned: true, color: "#2f6fed" });
    expect(events.b.title).toBe("🎂 Birthday");
    expect(events.c.title).toBe("Rent");
    expect(events.d.title).toBe("Sober");
    expect(eventCountdown(events.b)).toEqual({ date: "1990-03-14", direction: "until", repeat: "yearly" });
    expect(eventCountdown(events.c)?.repeat).toBe("monthly");
    expect(eventCountdown(events.d)).toEqual({ date: "2025-06-01", direction: "since", repeat: "none" });
  });

  it("works on a database with no countdowns", () => {
    const db = new DatabaseSync(":memory:");
    apply(db, 1, 8);
    expect(db.prepare("SELECT count(*) AS n FROM calendar_events").get()).toEqual({ n: 0 });
  });
});
