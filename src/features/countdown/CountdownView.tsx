import { format } from "date-fns";
import { Check, Hourglass, Pin, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Dialog } from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { ACCENT_PRESETS } from "../../domain/color";
import { countdownDays, countdownLabel, targetDate, type Countdown } from "../../domain/countdown";
import { addDaysLocal, fromLocalDate, todayLocal } from "../../domain/dates";
import { deleteCountdown, saveCountdown, useCountdowns } from "../../stores/countdowns";
import { confirm } from "../../stores/ui";

const EMOJI = ["⏳", "🎂", "✈️", "🎓", "💍", "🎄", "🏖️", "🚭", "🏁", "📅", "❤️", "🎉"];

export function CountdownView() {
  const map = useCountdowns((s) => s.items);
  const [editing, setEditing] = useState<Countdown | "new" | null>(null);
  const today = todayLocal();
  // Pinned first, then soonest upcoming, then "since" counters.
  const items = useMemo(
    () =>
      Object.values(map).sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || Number(a.direction === "since") - Number(b.direction === "since") || countdownDays(a, today) - countdownDays(b, today),
      ),
    [map, today],
  );

  if (!items.length)
    return (
      <>
        <EmptyState icon={Hourglass} title="Count down to something">
          <p>Birthdays, trips, deadlines, or days since you started something.</p>
          <button type="button" onClick={() => setEditing("new")} className="mt-4 h-9 rounded-sm bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover">
            New countdown
          </button>
        </EmptyState>
        {editing && <CountdownDialog item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      </>
    );

  return (
    <div className="scroll-thin h-full overflow-y-auto px-6 pb-10">
      <div className="mb-4 flex justify-end">
        <button type="button" onClick={() => setEditing("new")} className="flex h-8 items-center gap-1.5 rounded-sm bg-accent px-3 text-xs font-medium text-accent-fg hover:bg-accent-hover">
          <Plus size={14} /> New countdown
        </button>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
        {items.map((c) => {
          const n = countdownDays(c, today);
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setEditing(c)}
                className="flex h-full w-full flex-col rounded-lg border border-border bg-surface-2 p-4 text-left shadow-sm transition-shadow hover:shadow-lg"
                style={{ borderTop: `3px solid ${c.color}` }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{c.emoji}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{c.title}</span>
                  {c.pinned && <Pin size={13} className="text-accent" />}
                </div>
                <div className="mt-3 font-mono text-5xl font-semibold tabular-nums">{Math.abs(n)}</div>
                <div className="text-sm text-fg-2">{countdownLabel(c, today).replace(/^\d+ /, "")}</div>
                <div className="mt-2 text-xs text-muted">
                  {format(fromLocalDate(c.direction === "until" ? targetDate(c, today) : c.date), "EEE, MMM d, yyyy")}
                  {c.repeat !== "none" && ` · repeats ${c.repeat}`}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {editing && <CountdownDialog item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CountdownDialog({ item, onClose }: { item: Countdown | null; onClose: () => void }) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [date, setDate] = useState(item?.date ?? addDaysLocal(todayLocal(), 30));
  const [direction, setDirection] = useState<Countdown["direction"]>(item?.direction ?? "until");
  const [repeat, setRepeat] = useState<Countdown["repeat"]>(item?.repeat ?? "none");
  const [emoji, setEmoji] = useState(item?.emoji ?? "⏳");
  const [color, setColor] = useState(item?.color ?? ACCENT_PRESETS[0].hex);
  const [pinned, setPinned] = useState(item?.pinned ?? false);
  const field = "h-9 rounded-sm border border-border bg-surface px-2.5 text-sm outline-none focus:border-accent";
  return (
    <Dialog label={item ? "Edit countdown" : "New countdown"} onClose={onClose}>
      <form
        className="space-y-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          saveCountdown({ id: item?.id, title: title.trim(), date, direction, repeat: direction === "since" ? "none" : repeat, emoji, color, pinned });
          onClose();
        }}
      >
        <h2 className="text-lg font-semibold">{item ? "Edit countdown" : "New countdown"}</h2>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Trip to Japan" aria-label="Title" className={`${field} h-10 w-full`} />
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Direction" className="flex rounded-sm border border-border bg-bg p-0.5">
            {(["until", "since"] as const).map((d) => (
              <button key={d} type="button" role="radio" aria-checked={direction === d} onClick={() => setDirection(d)} className={`h-8 rounded-[6px] px-3 text-xs ${direction === d ? "bg-surface-2 font-semibold shadow-sm" : "text-muted"}`}>
                {d === "until" ? "Days until" : "Days since"}
              </button>
            ))}
          </div>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" className={field} />
          {direction === "until" && (
            <select value={repeat} onChange={(e) => setRepeat(e.target.value === "yearly" ? "yearly" : e.target.value === "monthly" ? "monthly" : "none")} aria-label="Repeat" className={field}>
              <option value="none">Once</option>
              <option value="yearly">Every year</option>
              <option value="monthly">Every month</option>
            </select>
          )}
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Icon">
          {EMOJI.map((e) => (
            <button key={e} type="button" aria-pressed={emoji === e} onClick={() => setEmoji(e)} className={`grid size-9 place-items-center rounded-sm text-lg ${emoji === e ? "bg-accent-soft ring-1 ring-accent" : "hover:bg-hover"}`}>
              {e}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Color">
          {ACCENT_PRESETS.map((p) => (
            <button key={p.hex} type="button" aria-label={p.name} aria-pressed={color === p.hex} onClick={() => setColor(p.hex)} className="grid size-7 place-items-center rounded-full" style={{ background: p.hex }}>
              {color === p.hex && <Check size={14} strokeWidth={3} className="text-white" />}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="size-4 accent-[var(--accent)]" /> Pin to top
          </label>
        </div>
        <div className="flex items-center gap-2 border-t border-border pt-4">
          {item && (
            <Button
              variant="ghost"
              className="text-danger"
              onClick={async () => {
                if (await confirm(`Delete “${item.title}”?`, "This countdown is removed.")) {
                  deleteCountdown(item.id);
                  onClose();
                }
              }}
            >
              <Trash2 size={15} /> Delete
            </Button>
          )}
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!title.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
