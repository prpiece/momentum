import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../domain/types";

const ev = (id: string, parent: string | null): CalendarEvent => ({
  id, title: id, notes: "", schedule: { kind: "day", date: "2026-11-02" }, spanDays: 1, color: "#2f6fed", subscriptionId: null,
  countdown: "until", pinned: false, recurrence: null, recurrenceParentId: parent, source: "ics",
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", deletedAt: null,
});

describe("saveEvents", () => {
  it("writes a series before its overrides, so an .ics with RECURRENCE-ID first still saves whole", async () => {
    const { setDriver, failedWrites } = await import("./client");
    const { saveEvents } = await import("./repo");
    const saved: string[] = [];
    setDriver(async () => ({
      select: async <T,>() => [] as T,
      execute: async (_sql: string, params?: unknown[]) => {
        const id = String(params?.[0]);
        if (id === "u-override" && !saved.includes("u")) throw new Error("FOREIGN KEY constraint failed");
        saved.push(id);
        return { rowsAffected: 1 };
      },
    }));
    await failedWrites(() => saveEvents([ev("u-override", "u"), ev("u", null), ev("other", null)]));
    expect(saved).toEqual(["u", "other", "u-override"]);
  }, 30_000); // first import pulls in the whole db layer

  it("reports a failed save instead of resolving as if it worked (override with no master)", async () => {
    const { setDriver, failedWrites } = await import("./client");
    const { saveEvents } = await import("./repo");
    setDriver(async () => ({
      select: async <T,>() => [] as T,
      execute: async (_sql: string, params?: unknown[]) => {
        if (params?.[0] === "orphan") throw new Error("FOREIGN KEY constraint failed");
        return { rowsAffected: 1 };
      },
    }));
    await expect(failedWrites(() => saveEvents([ev("orphan", "gone"), ev("ok", null)]))).rejects.toThrow(/FOREIGN KEY/);
  });
});
