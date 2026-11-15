import { describe, expect, it } from "vitest";
import * as core from "../../supabase/functions/inbound/core.bundle.js";
import { chatViews } from "../../supabase/functions/inbound/view";

// The chat bots list Today through chatViews; it must match the app (the user's /task bug: a
// "Math" task showed that was not in the app's Today).
const row = (id: string, listId: string, extra: Record<string, unknown> = {}) => ({
  id, title: id, list_id: listId, status: "open", priority: 0, due_date: "2020-01-01", tags: "[]", checklist: "[]", reminders: "[]",
  exdates: "[]", sort_order: 0, pinned: 0, created_at: "2020-01-01T00:00:00.000Z", updated_at: "2020-01-01T00:00:00.000Z", deleted_at: null, ...extra,
});
const tasks = (...rows: ReturnType<typeof row>[]) => rows.map((r) => core.parseTask(r)!);
const lists = (...ids: [string, boolean][]) => ids.map(([id, archived]) => core.parseList({ id, name: id, archived: archived ? 1 : 0, deleted_at: null })!);
const today = (vms: ReturnType<typeof chatViews>) => vms.filter((v) => core.inSmartList("today", v, "2026-11-16")).map((v) => v.task.id);

describe("chat views agree with the app", () => {
  it("drops tasks of archived lists and of lists that no longer exist", () => {
    const vms = chatViews(
      tasks(row("a", "work"), row("b", "old"), row("c", "gone"), row("d", "inbox")),
      lists(["work", false], ["old", true]),
    );
    expect(today(vms).sort()).toEqual(["a", "d"]);
  });
  it("resolves a wait on a finished task", () => {
    const vms = chatViews(
      tasks(row("w", "inbox", { waiting: '{"kind":"task","taskId":"x"}' }), row("x", "inbox", { status: "done", due_date: null })),
      [],
    );
    expect(today(vms)).toEqual(["w"]);
  });
});
