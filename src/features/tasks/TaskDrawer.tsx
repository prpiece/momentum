import { format } from "date-fns";
import { Ban, ChevronLeft, Copy, Flag, Hash, ListChecks, Pin, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { IconButton } from "../../components/ui/Dialog";
import { TaskCheckbox } from "../../components/ui/TaskCheckbox";
import { loadActivity } from "../../db/repo";
import { scheduleForKey } from "../../domain/recurrence";
import { MAX_SUBTASK_DEPTH, PRIORITIES, PRIORITY_LABEL, type Activity, type Task } from "../../domain/types";
import { addTask, depthOf, duplicateTask, ensureTags, uid, updateTask, useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { closeDrawer, openTask, useUi } from "../../stores/ui";
import { deleteTasks, editTask, setWontDo, toggleDone } from "./actions";
import { ScheduleEditor } from "./ScheduleEditor";
import { useDerived } from "./selectors";

/** Slide-over detail panel, docked on the side opposite the sidebar. */
export function TaskDrawer() {
  const drawer = useUi((s) => s.drawer);
  const task = useData((s) => (drawer ? s.tasks[drawer.id] : undefined));
  const side = useSettings((s) => (s.settings.sidebarSide === "left" ? "right" : "left"));

  useEffect(() => {
    if (drawer && (!task || task.deletedAt)) closeDrawer();
  }, [drawer, task]);

  if (!drawer || !task || task.deletedAt) return null;
  return (
    <aside
      key={task.id}
      aria-label="Task details"
      className={`${side === "right" ? "anim-slide-right right-2 border-l" : "anim-slide-left left-2 border-r"} absolute inset-y-2 z-40 flex w-[26rem] max-w-[calc(100%-1rem)] flex-col rounded-lg border border-border bg-surface-2 shadow-lg`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !(e.target instanceof HTMLTextAreaElement)) closeDrawer();
      }}
    >
      <DrawerBody task={task} occurrenceKey={drawer.key} />
    </aside>
  );
}

function DrawerBody({ task: t, occurrenceKey }: { task: Task; occurrenceKey: string | null }) {
  const derived = useDerived();
  const lists = useData((s) => s.lists);
  const tags = useData((s) => s.tags);
  const parent = useData((s) => (t.parentId ? s.tasks[t.parentId] : undefined));
  const vm = derived.byId.get(t.id);
  const key = occurrenceKey ?? vm?.key ?? null;
  const shown = t.recurrence && key ? scheduleForKey(t.schedule, key) : (vm?.schedule ?? t.schedule);
  const set = (patch: Partial<Task>) => updateTask(t.id, patch);

  return (
    <>
      <header className="flex items-center gap-1 border-b border-border px-3 py-2">
        {parent ? (
          <button type="button" onClick={() => openTask(parent.id)} className="flex min-w-0 items-center gap-1 rounded-sm px-1.5 py-1 text-xs text-muted hover:bg-hover hover:text-fg">
            <ChevronLeft size={14} />
            <span className="truncate">{parent.title}</span>
          </button>
        ) : (
          <select
            aria-label="List"
            value={t.listId}
            onChange={(e) => set({ listId: e.target.value })}
            className="h-8 max-w-44 truncate rounded-sm bg-transparent px-1.5 text-sm text-fg-2 hover:bg-hover"
          >
            {Object.values(lists)
              .filter((l) => !l.archived || l.id === t.listId)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.emoji ? `${l.emoji} ` : ""}
                  {l.name}
                </option>
              ))}
          </select>
        )}
        <div className="flex-1" />
        <IconButton label={t.pinned ? "Unpin" : "Pin"} active={t.pinned} onClick={() => set({ pinned: !t.pinned })}>
          <Pin size={16} />
        </IconButton>
        <IconButton label="Duplicate" onClick={() => duplicateTask(t.id)}>
          <Copy size={16} />
        </IconButton>
        <IconButton label={t.status === "wont_do" ? "Reopen" : "Won't do"} active={t.status === "wont_do"} onClick={() => setWontDo(t.id, key)}>
          <Ban size={16} />
        </IconButton>
        <IconButton label="Delete" onClick={() => void deleteTasks([t.id], key)}>
          <Trash2 size={16} />
        </IconButton>
        <IconButton label="Close" onClick={closeDrawer}>
          <X size={17} />
        </IconButton>
      </header>

      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="pt-1.5">
            <TaskCheckbox status={t.status} priority={t.priority} onToggle={() => toggleDone(t.id, key)} label="Complete" size={20} />
          </div>
          <TitleInput task={t} />
        </div>

        <div className="flex items-center gap-1" role="radiogroup" aria-label="Priority">
          <Flag size={16} className="mr-2 text-muted" />
          {[...PRIORITIES].reverse().map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={t.priority === p}
              onClick={() => set({ priority: p })}
              className={`flex h-7 items-center gap-1 rounded-full px-2.5 text-xs transition-colors ${t.priority === p ? "bg-accent-soft font-semibold text-fg ring-1 ring-accent" : "text-fg-2 hover:bg-hover"}`}
            >
              <Flag size={12} style={{ color: p ? `var(--p${p})` : "var(--fg-muted)" }} fill={p ? `var(--p${p})` : "none"} />
              {PRIORITY_LABEL[p]}
            </button>
          ))}
        </div>

        <ScheduleEditor
          schedule={shown}
          recurrence={t.recurrence}
          reminders={t.reminders}
          onSchedule={(schedule) => void editTask(t.id, { schedule }, key)}
          onRecurrence={(recurrence) => void editTask(t.id, { recurrence, ...(recurrence && t.schedule.kind === "none" ? { schedule: shown } : {}) }, key)}
          onReminders={(reminders) => set({ reminders })}
        />

        <TagEditor task={t} tags={tags} />
        <Description task={t} />
        <Subtasks task={t} />
        <Checklist task={t} />
        <ActivityLog task={t} />
      </div>
    </>
  );
}

function TitleInput({ task }: { task: Task }) {
  const [v, setV] = useState(task.title);
  useEffect(() => setV(task.title), [task.title]);
  const commit = () => v.trim() && v !== task.title && updateTask(task.id, { title: v.trim() });
  return (
    <textarea
      aria-label="Title"
      value={v}
      rows={1}
      onChange={(e) => setV(e.target.value.replace(/\n/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className={`field-sizing-content min-h-8 flex-1 resize-none bg-transparent text-lg font-semibold leading-7 outline-none ${task.status !== "open" ? "text-muted line-through" : ""}`}
    />
  );
}

function TagEditor({ task, tags }: { task: Task; tags: Record<string, { id: string; name: string }> }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const name = draft.replace(/^#/, "").trim();
    if (!name) return;
    updateTask(task.id, { tags: [...new Set([...task.tags, ...ensureTags([name])])] });
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Hash size={16} className="mr-1.5 text-muted" />
      {task.tags.map((id) =>
        tags[id] ? (
          <span key={id} className="inline-flex items-center gap-1 rounded-full bg-hover py-0.5 pl-2.5 pr-1 text-xs">
            #{tags[id].name}
            <button type="button" aria-label={`Remove tag ${tags[id].name}`} onClick={() => updateTask(task.id, { tags: task.tags.filter((x) => x !== id) })} className="rounded-full p-0.5 hover:bg-hover">
              <X size={11} />
            </button>
          </span>
        ) : null,
      )}
      <input
        list="momentum-tags"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        onBlur={add}
        placeholder="Add tag"
        aria-label="Add tag"
        className="h-7 w-24 bg-transparent text-xs outline-none placeholder:text-muted"
      />
      <datalist id="momentum-tags">
        {Object.values(tags).map((t) => (
          <option key={t.id} value={t.name} />
        ))}
      </datalist>
    </div>
  );
}

function Description({ task }: { task: Task }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(task.description);
  useEffect(() => setV(task.description), [task.description]);
  if (!editing && task.description)
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label="Edit description"
        onClick={(e) => !(e.target instanceof HTMLAnchorElement) && setEditing(true)}
        onKeyDown={(e) => e.key === "Enter" && setEditing(true)}
        className="prose-md cursor-text rounded-md p-2 text-sm text-fg-2 hover:bg-hover"
      >
        <ReactMarkdown>{task.description}</ReactMarkdown>
      </div>
    );
  return (
    <textarea
      autoFocus={editing}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false);
        if (v !== task.description) updateTask(task.id, { description: v });
      }}
      placeholder="Notes (Markdown supported)"
      aria-label="Description"
      className="field-sizing-content min-h-20 w-full resize-none rounded-md border border-transparent bg-transparent p-2 text-sm outline-none placeholder:text-muted hover:border-border focus:border-accent"
    />
  );
}

function Subtasks({ task }: { task: Task }) {
  const derived = useDerived();
  const kids = derived.childrenOf(task.id);
  const [draft, setDraft] = useState("");
  const canNest = depthOf(task.id) < MAX_SUBTASK_DEPTH;
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Subtasks {kids.length > 0 && `· ${kids.filter((k) => k.task.status !== "open").length}/${kids.length}`}</h3>
      <ul className="space-y-0.5">
        {kids.map((k) => (
          <li key={k.task.id} className="flex items-center gap-2.5 rounded-sm px-1 py-1 hover:bg-hover">
            <TaskCheckbox status={k.task.status} priority={k.task.priority} onToggle={() => toggleDone(k.task.id, k.key)} label={`Complete ${k.task.title}`} size={16} />
            <button type="button" onClick={() => openTask(k.task.id, k.key)} className={`flex-1 truncate text-left text-sm ${k.task.status !== "open" ? "text-muted line-through" : ""}`}>
              {k.task.title}
            </button>
          </li>
        ))}
      </ul>
      {canNest ? (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              addTask({ title: draft.trim(), parentId: task.id, listId: task.listId }, "bottom");
              setDraft("");
            }
          }}
          placeholder="+ Add subtask"
          aria-label="Add subtask"
          className="mt-1 h-8 w-full rounded-sm bg-transparent px-1 text-sm outline-none placeholder:text-muted"
        />
      ) : (
        <p className="mt-1 text-xs text-muted">Subtasks can nest up to {MAX_SUBTASK_DEPTH} levels.</p>
      )}
    </section>
  );
}

function Checklist({ task }: { task: Task }) {
  const [draft, setDraft] = useState("");
  const items = task.checklist;
  const set = (checklist: Task["checklist"]) => updateTask(task.id, { checklist });
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
        <ListChecks size={14} /> Checklist {items.length > 0 && `· ${items.filter((i) => i.done).length}/${items.length}`}
      </h3>
      <ul className="space-y-0.5">
        {items.map((it) => (
          <li key={it.id} className="group flex items-center gap-2.5 rounded-sm px-1 py-0.5 hover:bg-hover">
            <input type="checkbox" checked={it.done} onChange={() => set(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))} className="size-4 accent-[var(--accent)]" aria-label={it.title} />
            <input
              defaultValue={it.title}
              onBlur={(e) => e.target.value !== it.title && set(items.map((x) => (x.id === it.id ? { ...x, title: e.target.value } : x)))}
              className={`h-7 flex-1 bg-transparent text-sm outline-none ${it.done ? "text-muted line-through" : ""}`}
              aria-label="Checklist item"
            />
            <button type="button" aria-label="Remove item" onClick={() => set(items.filter((x) => x.id !== it.id))} className="opacity-0 group-hover:opacity-100">
              <X size={13} className="text-muted" />
            </button>
          </li>
        ))}
      </ul>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            set([...items, { id: uid(), title: draft.trim(), done: false }]);
            setDraft("");
          }
        }}
        placeholder="+ Add item"
        aria-label="Add checklist item"
        className="mt-1 h-8 w-full rounded-sm bg-transparent px-1 text-sm outline-none placeholder:text-muted"
      />
    </section>
  );
}

const ACTIVITY_TEXT: Record<Activity["kind"], string> = {
  created: "Created",
  completed: "Completed",
  reopened: "Reopened",
  wont_do: "Marked won't do",
  moved: "Moved to",
  scheduled: "Rescheduled",
  priority: "Priority set to",
  renamed: "Renamed to",
};

function ActivityLog({ task }: { task: Task }) {
  const [items, setItems] = useState<Activity[]>([]);
  useEffect(() => {
    let live = true;
    void loadActivity(task.id).then((a) => live && setItems(a));
    return () => void (live = false);
  }, [task.id, task.updatedAt]);
  return (
    <section className="border-t border-border pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Activity</h3>
      <ul className="space-y-1 text-xs text-muted">
        {items.filter((a) => a.kind !== "created").map((a) => (
          <li key={a.id}>
            <span className="font-mono">{format(new Date(a.at), "MMM d, HH:mm")}</span> · {ACTIVITY_TEXT[a.kind]} {a.detail}
          </li>
        ))}
        <li>
          <span className="font-mono">{format(new Date(task.createdAt), "MMM d, HH:mm")}</span> · Created
        </li>
      </ul>
    </section>
  );
}
