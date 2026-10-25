import { CalendarDays, CheckCheck, Flag, FolderInput, Hash, Trash2, X } from "lucide-react";
import { MenuItem, MenuSeparator, Popover, useMenu } from "../../components/ui/Popover";
import { addDaysLocal, todayLocal } from "../../domain/dates";
import { PRIORITIES, PRIORITY_LABEL, type Schedule } from "../../domain/types";
import { withUndo } from "../../lib/undo";
import { moveTasks, setStatus, useData } from "../../stores/data";
import { setSelection, useUi } from "../../stores/ui";
import { bulkEdit, deleteTasks } from "./actions";

/** Appears when 2+ tasks are selected (Ctrl/Shift+click). */
export function BulkBar() {
  const selection = useUi((s) => s.selection);
  const lists = useData((s) => s.lists);
  const tags = useData((s) => s.tags);
  const dateMenu = useMenu();
  const prioMenu = useMenu();
  const listMenu = useMenu();
  const tagMenu = useMenu();
  if (selection.length < 2) return null;
  const n = selection.length;
  const today = todayLocal();
  const setDate = (label: string, schedule: Schedule) => {
    dateMenu.close();
    bulkEdit(selection, `Rescheduled ${n} tasks`, () => ({ schedule }));
    void label;
  };
  const btn = "flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-sm hover:bg-hover";

  return (
    <div role="toolbar" aria-label="Bulk edit" className="anim-rise absolute inset-x-0 bottom-5 z-30 mx-auto flex w-fit items-center gap-1 rounded-lg border border-border bg-surface-2 p-1.5 shadow-lg">
      <span className="px-2.5 text-sm font-semibold">{n} selected</span>
      <button type="button" className={btn} onClick={() => withUndo(`Completed ${n} tasks`, () => selection.forEach((id) => setStatus(id, "done")))}>
        <CheckCheck size={16} /> Complete
      </button>
      <button ref={dateMenu.anchor} type="button" className={btn} onClick={dateMenu.toggle}>
        <CalendarDays size={16} /> Date
      </button>
      <button ref={prioMenu.anchor} type="button" className={btn} onClick={prioMenu.toggle}>
        <Flag size={16} /> Priority
      </button>
      <button ref={listMenu.anchor} type="button" className={btn} onClick={listMenu.toggle}>
        <FolderInput size={16} /> Move
      </button>
      <button ref={tagMenu.anchor} type="button" className={btn} onClick={tagMenu.toggle}>
        <Hash size={16} /> Tag
      </button>
      <button type="button" className={`${btn} text-danger`} onClick={() => void deleteTasks(selection)}>
        <Trash2 size={16} /> Delete
      </button>
      <button type="button" aria-label="Clear selection" className="grid size-8 place-items-center rounded-sm text-muted hover:bg-hover" onClick={() => setSelection([])}>
        <X size={16} />
      </button>

      {dateMenu.open && (
        <Popover anchor={dateMenu.anchor} onClose={dateMenu.close}>
          <MenuItem onSelect={() => setDate("Today", { kind: "day", date: today })}>Today</MenuItem>
          <MenuItem onSelect={() => setDate("Tomorrow", { kind: "day", date: addDaysLocal(today, 1) })}>Tomorrow</MenuItem>
          <MenuItem onSelect={() => setDate("Next week", { kind: "day", date: addDaysLocal(today, 7) })}>Next week</MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => setDate("No date", { kind: "none" })}>No date</MenuItem>
        </Popover>
      )}
      {prioMenu.open && (
        <Popover anchor={prioMenu.anchor} onClose={prioMenu.close}>
          {[...PRIORITIES].reverse().map((p) => (
            <MenuItem key={p} icon={<Flag size={14} style={{ color: p ? `var(--p${p})` : undefined }} />} onSelect={() => (prioMenu.close(), bulkEdit(selection, `Set priority on ${n} tasks`, () => ({ priority: p })))}>
              {PRIORITY_LABEL[p]}
            </MenuItem>
          ))}
        </Popover>
      )}
      {listMenu.open && (
        <Popover anchor={listMenu.anchor} onClose={listMenu.close}>
          {Object.values(lists)
            .filter((l) => !l.archived)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((l) => (
              <MenuItem key={l.id} icon={l.emoji ?? undefined} onSelect={() => (listMenu.close(), withUndo(`Moved ${n} tasks to ${l.name}`, () => moveTasks(selection, l.id)))}>
                {l.name}
              </MenuItem>
            ))}
        </Popover>
      )}
      {tagMenu.open && (
        <Popover anchor={tagMenu.anchor} onClose={tagMenu.close}>
          {Object.values(tags).length === 0 && <div className="px-3 py-2 text-sm text-muted">No tags yet. Add “#tag” in quick add.</div>}
          {Object.values(tags).map((tag) => (
            <MenuItem key={tag.id} onSelect={() => (tagMenu.close(), bulkEdit(selection, `Tagged ${n} tasks`, (t) => ({ tags: [...new Set([...t.tags, tag.id])] })))}>
              #{tag.name}
            </MenuItem>
          ))}
        </Popover>
      )}
    </div>
  );
}
