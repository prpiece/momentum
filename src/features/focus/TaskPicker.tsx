import { Check, ChevronDown, ChevronRight, Search } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { ListGlyph } from "../../components/ui/AppIcon";
import { Popover } from "../../components/ui/Popover";
import { type FocusPick, NO_PICK, pickLabel, rangeBetween, withRange } from "../../domain/focus";
import { sortVMs } from "../../domain/taskViews";
import { useData } from "../../stores/data";
import { useDerived } from "../tasks/selectors";

/**
 * The Focus page's task chooser (replaces the native select): search, rows with a subtask flyout.
 * Pick the whole task, one subtask (click its title), or several (circles: click, Shift+click, drag).
 */
export function TaskPicker({ value, onChange }: { value: FocusPick; onChange: (p: FocusPick) => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const tasks = useData((s) => s.tasks);
  const root = value.taskId ? tasks[value.taskId] : undefined;
  const label = pickLabel(root ? root.title || "Untitled" : null, value.subIds.flatMap((id) => (tasks[id] ? [tasks[id].title || "Untitled"] : [])));
  const close = () => {
    setOpen(false);
    anchor.current?.focus();
  };
  return (
    <>
      <button ref={anchor} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`Task to focus on: ${label}`} onClick={() => setOpen((o) => !o)} className="input flex h-[var(--control-lg)] w-80 max-w-full items-center gap-2 rounded-card text-left font-medium">
        <span className={`min-w-0 flex-1 truncate ${root ? "" : "text-muted"}`}>{label}</span>
        <ChevronDown size={16} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden />
      </button>
      {open && (
        <Popover anchor={anchor} onClose={close} className="w-[340px] max-w-[calc(100vw-16px)]">
          <Panel
            value={value}
            onPick={(p) => {
              onChange(p);
              close();
            }}
          />
        </Popover>
      )}
    </>
  );
}

const rowCls = (active: boolean, kbd: boolean) => `flex min-h-8 cursor-default items-center gap-2.5 rounded-control px-2 text-[length:var(--fs-sm)] ${active ? "bg-surface-2" : ""} ${active && kbd ? "outline outline-2 -outline-offset-2 outline-accent-text" : ""}`;

function Panel({ value, onPick }: { value: FocusPick; onPick: (p: FocusPick) => void }) {
  const derived = useDerived();
  const tasks = useData((s) => s.tasks);
  const lists = useData((s) => s.lists);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [kbd, setKbd] = useState(false);
  const [zone, setZone] = useState<"main" | "sub">("main");
  const [fly, setFly] = useState<{ id: string; top: number; x: number } | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [subActive, setSubActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const hover = useRef<number>(0);
  const drag = useRef<{ on: boolean; anchor: string; base: string[] } | null>(null);
  const lastToggled = useRef<string | null>(null);

  useEffect(() => {
    const end = () => (drag.current = null);
    window.addEventListener("pointerup", end);
    return () => window.removeEventListener("pointerup", end);
  }, []);

  const rows = useMemo(() => {
    const open = sortVMs(derived.roots.filter((v) => v.task.status === "open"), "date").slice(0, 200).map((v) => v.task);
    const bound = value.taskId ? tasks[value.taskId] : undefined;
    if (bound && !open.some((t) => t.id === bound.id)) open.unshift(bound);
    const needle = q.trim().toLowerCase();
    const kids = (id: string) => derived.childrenOf(id).filter((k) => k.task.status === "open").map((k) => k.task);
    return open.map((t) => ({ t, kids: kids(t.id) })).filter(({ t, kids: ks }) => !needle || t.title.toLowerCase().includes(needle) || ks.some((k) => k.title.toLowerCase().includes(needle)));
  }, [derived, tasks, value.taskId, q]);

  const flyRow = fly ? rows.find((r) => r.t.id === fly.id) : undefined;
  const subs = flyRow?.kids ?? [];
  const subIds = subs.map((s) => s.id);

  const openFly = (id: string, rowEl: Element | null) => {
    const r = rows.find((x) => x.t.id === id);
    if (!r?.kids.length || !rowEl || !wrap.current) return setFly(null);
    const w = wrap.current.getBoundingClientRect();
    const est = Math.min(window.innerHeight * 0.6, 96 + r.kids.length * 32);
    const top = Math.max(0, Math.min(rowEl.getBoundingClientRect().top - w.top, window.innerHeight - 8 - w.top - est));
    // Right of the picker, else left of it, else overlapping it inside the window (FLY = flyout width + gap).
    const FLY = 288;
    const x = w.right + FLY <= window.innerWidth - 8 ? w.width + 8 : w.left - FLY >= 8 ? -FLY : window.innerWidth - 8 - FLY - w.left;
    setFly({ id, top, x });
    setDraft(value.taskId === id ? value.subIds : []);
    setSubActive(0);
    lastToggled.current = null;
  };
  const closeFly = () => {
    setFly(null);
    setZone("main");
  };
  const commitSubs = (ids: string[]) => fly && onPick({ taskId: fly.id, subIds: ids });

  const applyRange = (a: string, b: string, on: boolean, base: string[]) => setDraft(withRange(subIds, base, rangeBetween(subIds, a, b), on));
  const toggleAt = (id: string, shift: boolean) => {
    const on = !draft.includes(id);
    applyRange(shift && lastToggled.current ? lastToggled.current : id, id, on, draft);
    lastToggled.current = id;
  };

  const onKey = (e: KeyboardEvent) => {
    const move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (move || e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Enter" || (e.key === " " && zone === "sub")) setKbd(true);
    if (zone === "sub" && fly) {
      if (move) setSubActive((i) => Math.min(subs.length - 1, Math.max(0, i + move)));
      else if (e.key === " ") toggleAt(subIds[subActive], e.shiftKey);
      else if (e.key === "Enter") commitSubs(draft.length ? draft : [subIds[subActive]]);
      else if (e.key !== "ArrowLeft") return;
      else closeFly();
      return e.preventDefault();
    }
    if (move) {
      const n = Math.min(rows.length, Math.max(0, active + move));
      setActive(n);
      if (n > 0) document.getElementById(`pk-${rows[n - 1].t.id}`)?.scrollIntoView({ block: "nearest" });
      closeFly();
    } else if (e.key === "ArrowRight" && active > 0 && rows[active - 1].kids.length && (e.target as HTMLInputElement).selectionStart === q.length) {
      openFly(rows[active - 1].t.id, document.getElementById(`pk-${rows[active - 1].t.id}`));
      setZone("sub");
    } else if (e.key === "Enter") onPick(active === 0 ? NO_PICK : { taskId: rows[active - 1].t.id, subIds: [] });
    else return;
    e.preventDefault();
  };

  const stopDrag = (e: PointerEvent) => e.preventDefault();

  return (
    <div ref={wrap} className="relative" onKeyDown={onKey} onPointerMove={() => setKbd(false)}>
      <div className="flex items-center gap-2 border-b border-border px-2 pb-1.5 pt-1">
        <Search size={14} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden />
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(e.target.value ? 1 : 0);
            closeFly();
          }}
          placeholder="Search tasks"
          aria-label="Search tasks"
          role="combobox"
          aria-expanded
          aria-controls="pk-list"
          aria-activedescendant={zone === "sub" && fly ? `pks-${subIds[subActive]}` : active === 0 ? "pk-none" : `pk-${rows[active - 1]?.t.id}`}
          className="h-8 min-w-0 flex-1 bg-transparent text-[length:var(--fs-sm)] outline-none placeholder:text-muted"
        />
      </div>
      <ul id="pk-list" role="listbox" aria-label="Tasks" className="mt-1 max-h-72 overflow-y-auto">
        <li
          id="pk-none"
          role="option"
          aria-selected={!value.taskId}
          onPointerEnter={() => {
            setActive(0);
            closeFly();
          }}
          onClick={() => onPick(NO_PICK)}
          className={rowCls(active === 0 && zone === "main", kbd)}
        >
          <span aria-hidden aria-checked={!value.taskId} className="check sm"><Check strokeWidth={2.75} /></span>
          <span className="min-w-0 flex-1 truncate">No specific task</span>
        </li>
        {rows.map(({ t, kids }, i) => {
          const list = lists[t.listId];
          const isOn = value.taskId === t.id;
          return (
            <li
              key={t.id}
              id={`pk-${t.id}`}
              role="option"
              aria-selected={isOn}
              aria-haspopup={kids.length ? "listbox" : undefined}
              onPointerEnter={(e) => {
                const el = e.currentTarget;
                setActive(i + 1);
                setZone("main");
                window.clearTimeout(hover.current);
                hover.current = window.setTimeout(() => openFly(t.id, el), fly ? 150 : 0);
              }}
              onClick={() => onPick({ taskId: t.id, subIds: [] })}
              className={rowCls(active === i + 1 && zone === "main", kbd)}
            >
              <span aria-hidden aria-checked={isOn && !value.subIds.length} className="check sm"><Check strokeWidth={2.75} /></span>
              <span className="min-w-0 flex-1 truncate">{t.title || "Untitled"}</span>
              {list && <ListGlyph icon={list.icon} color={list.color} size={14} />}
              {kids.length > 0 && (
                <span className="flex shrink-0 items-center text-[length:var(--fs-xs)] tabular-nums text-muted">
                  {isOn && value.subIds.length > 0 && <span className="mr-1 text-accent-text">{value.subIds.length}</span>}
                  {kids.length}
                  <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
                </span>
              )}
            </li>
          );
        })}
        {!rows.length && q && <li className="px-2 py-4 text-center text-[length:var(--fs-sm)] text-muted">No matching tasks.</li>}
      </ul>

      {fly && flyRow && (
        <div
          className="layer layer-raised anim-pop-in absolute z-10 w-[280px] select-none rounded-card p-1"
          style={{ top: fly.top, left: fly.x }}
          onPointerEnter={() => window.clearTimeout(hover.current)}
        >
          <div className="t-label truncate px-2 py-1 text-muted">{flyRow.t.title || "Untitled"}</div>
          <div role="option" aria-selected="false" onClick={() => onPick({ taskId: fly.id, subIds: [] })} className={`${rowCls(false, false)} hover:bg-surface-2`}>
            Whole task
          </div>
          <ul role="listbox" aria-multiselectable aria-label="Subtasks" className="max-h-56 overflow-y-auto">
            {subs.map((s, i) => {
              const on = draft.includes(s.id);
              return (
                <li
                  key={s.id}
                  id={`pks-${s.id}`}
                  role="option"
                  aria-selected={on}
                  onPointerEnter={(e) => {
                    setSubActive(i);
                    if (drag.current && e.buttons === 1) applyRange(drag.current.anchor, s.id, drag.current.on, drag.current.base);
                  }}
                  className={rowCls(zone === "sub" ? subActive === i : false, kbd) + " hover:bg-surface-2"}
                >
                  <span
                    aria-hidden
                    aria-checked={on}
                    className="check sm"
                    style={{ touchAction: "none" }}
                    onPointerDown={(e) => {
                      stopDrag(e);
                      if (e.shiftKey) return toggleAt(s.id, true);
                      drag.current = { on: !on, anchor: s.id, base: draft };
                      lastToggled.current = s.id;
                      applyRange(s.id, s.id, !on, draft);
                    }}
                  >
                    <Check strokeWidth={2.75} />
                  </span>
                  <span onClick={() => commitSubs([s.id])} title="Focus on just this one" className="min-w-0 flex-1 cursor-pointer truncate">
                    {s.title || "Untitled"}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-1 border-t border-border p-1">
            {/* A hint until something is ticked, rather than a disabled button that reads as active (D206). */}
            {draft.length ? (
              <button type="button" onClick={() => commitSubs(draft)} className="btn btn-primary btn-sm w-full">
                Focus on {draft.length} subtask{draft.length === 1 ? "" : "s"}
              </button>
            ) : (
              <p className="px-2 py-1 text-[length:var(--fs-xs)] text-muted">Tick circles to focus on several.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
