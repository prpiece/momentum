import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { format } from "date-fns";
import { Ban, CalendarDays, ChevronLeft, Copy, Flag, GripVertical, Hash, ImagePlus, ListChecks, ListTodo, Pin, Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { IconButton } from "../../components/ui/Dialog";
import { MenuItem, Popover, useMenu } from "../../components/ui/Popover";
import { TaskCheckbox } from "../../components/ui/TaskCheckbox";
import { isTauri } from "../../db/client";
import { loadActivity } from "../../db/repo";
import { importImage, MAX_IMAGE_BYTES, newImageName, writeImage } from "../../lib/appFiles";
import { scheduleForKey, summarizeSchedule } from "../../domain/recurrence";
import { MAX_SUBTASK_DEPTH, PRIORITIES, PRIORITY_LABEL, type Activity, type Task } from "../../domain/types";
import { addTask, depthOf, duplicateTask, ensureTags, reorderTask, uid, updateTask, useData } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { closeDrawer, openTask, toast, useUi } from "../../stores/ui";
import { deleteTasks, editTask, setWontDo, toggleDone } from "./actions";
import { NoteMarkdown } from "./NoteMarkdown";
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
        {parent && (
          <button type="button" onClick={() => openTask(parent.id)} className="flex min-w-0 items-center gap-1 rounded-sm px-1.5 py-1 text-xs text-muted hover:bg-hover hover:text-fg">
            <ChevronLeft size={14} />
            <span className="truncate">{parent.title}</span>
          </button>
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

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4 anim-stagger [&>*]:shrink-0">
        <div className="flex items-start gap-3">
          <div className="pt-1.5">
            <TaskCheckbox status={t.status} priority={t.priority} onToggle={() => toggleDone(t.id, key)} label="Complete" size={20} />
          </div>
          <TitleInput task={t} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Chip
            label="Priority"
            icon={<Flag size={13} style={{ color: t.priority ? `var(--p${t.priority})` : "var(--fg-muted)" }} fill={t.priority ? `var(--p${t.priority})` : "none"} />}
            text={t.priority ? PRIORITY_LABEL[t.priority] : "Priority"}
            set={t.priority !== 0}
          >
            {(close) => (
              <div className="flex items-center gap-1 p-1.5" role="radiogroup" aria-label="Priority">
                {[...PRIORITIES].reverse().map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={t.priority === p}
                    onClick={() => (set({ priority: p }), close())}
                    className={`flex h-7 items-center gap-1 rounded-full px-2.5 text-xs transition-colors ${t.priority === p ? "bg-accent-soft font-semibold text-fg ring-1 ring-accent" : "text-fg-2 hover:bg-hover"}`}
                  >
                    <Flag size={12} style={{ color: p ? `var(--p${p})` : "var(--fg-muted)" }} fill={p ? `var(--p${p})` : "none"} />
                    {PRIORITY_LABEL[p]}
                  </button>
                ))}
              </div>
            )}
          </Chip>
          <Chip label="Schedule" icon={<CalendarDays size={13} />} text={summarizeSchedule(shown, t.recurrence?.rule ?? null)} set={shown.kind !== "none"}>
            {() => (
              <div className="w-80 max-w-full p-3">
                <ScheduleEditor
                  schedule={shown}
                  recurrence={t.recurrence}
                  reminders={t.reminders}
                  onSchedule={(schedule) => void editTask(t.id, { schedule }, key)}
                  onRecurrence={(recurrence) => void editTask(t.id, { recurrence, ...(recurrence && t.schedule.kind === "none" ? { schedule: shown } : {}) }, key)}
                  onReminders={(reminders) => set({ reminders })}
                />
              </div>
            )}
          </Chip>
          {!parent && (
            <Chip label="List" icon={<ListTodo size={13} />} text={lists[t.listId]?.name ?? "List"} set>
              {(close) => (
                <div role="menu" className="max-h-64 min-w-44 overflow-y-auto">
                  {Object.values(lists)
                    .filter((l) => !l.archived || l.id === t.listId)
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((l) => (
                      <MenuItem key={l.id} active={l.id === t.listId} onSelect={() => (set({ listId: l.id }), close())}>
                        {l.name}
                      </MenuItem>
                    ))}
                </div>
              )}
            </Chip>
          )}
          <Chip
            label="Tags"
            icon={<Hash size={13} />}
            text={t.tags.length ? t.tags.map((id) => tags[id]?.name).filter(Boolean).map((n) => `#${n}`).join(" ") : "Tags"}
            set={t.tags.length > 0}
          >
            {() => (
              <div className="w-72 max-w-full p-3">
                <TagEditor task={t} tags={tags} />
              </div>
            )}
          </Chip>
        </div>

        <Description task={t} />
        <Subtasks task={t} />
        <Checklist task={t} />
        <ActivityLog task={t} />
      </div>
    </>
  );
}

/** Compact summary button that opens its editor in a popover; focus returns to the chip on close. */
function Chip({ label, icon, text, set, children }: { label: string; icon: ReactNode; text: string; set: boolean; children: (close: () => void) => ReactNode }) {
  const m = useMenu();
  const close = () => (m.close(), m.anchor.current?.focus());
  return (
    <>
      <button
        ref={m.anchor}
        type="button"
        aria-label={`${label}: ${text}`}
        aria-haspopup="dialog"
        aria-expanded={m.open}
        onClick={m.toggle}
        className={`flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors ${set ? "bg-accent-soft text-fg" : "bg-hover text-muted hover:text-fg"}`}
      >
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{text}</span>
      </button>
      {m.open && (
        <Popover anchor={m.anchor} onClose={close}>
          {children(close)}
        </Popover>
      )}
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
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (name: string) => {
    const el = ref.current;
    if (!el) return;
    const md = `![](attachment:${name})`;
    const at = el.selectionStart;
    setV(el.value.slice(0, at) + md + el.value.slice(el.selectionEnd));
    requestAnimationFrame(() => el.setSelectionRange(at + md.length, at + md.length));
  };
  const fail = (err: unknown) => toast(err instanceof Error ? err.message : String(err));
  const addImages = async (files: File[]) => {
    if (!isTauri) return toast("Images work in the desktop app.");
    for (const f of files) {
      const name = newImageName(f.type || f.name);
      if (!name) toast(`${f.name || "That file"} isn't a PNG, JPG, GIF or WebP image.`);
      else if (f.size > MAX_IMAGE_BYTES) toast("Images can be at most 10 MB.");
      else
        try {
          await writeImage("attachments", name, f);
          insert(name);
        } catch (err) {
          fail(err);
        }
    }
  };
  const pickImage = async () => {
    if (!isTauri) return toast("Images work in the desktop app.");
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({ multiple: false, directory: false, filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }] });
      if (typeof path !== "string") return;
      const name = newImageName(path);
      if (!name) return toast("That isn't a PNG, JPG, GIF or WebP image.");
      await importImage("attachments", name, path);
      insert(name);
    } catch (err) {
      fail(err);
    }
  };
  if (!editing && task.description)
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label="Edit description"
        onClick={(e) => !(e.target instanceof HTMLAnchorElement) && setEditing(true)}
        onKeyDown={(e) => e.key === "Enter" && setEditing(true)}
        className="prose-md min-h-32 grow cursor-text rounded-md p-2 text-sm text-fg-2 hover:bg-hover"
      >
        <NoteMarkdown>{task.description}</NoteMarkdown>
      </div>
    );
  return (
    <div className="flex min-h-32 grow flex-col">
      <textarea
        ref={ref}
        autoFocus={editing}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          if (v !== task.description) updateTask(task.id, { description: v });
        }}
        onPaste={(e) => {
          const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
          if (!imgs.length) return;
          e.preventDefault();
          void addImages(imgs);
        }}
        onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          void addImages([...e.dataTransfer.files]);
        }}
        placeholder="Write a note… (Markdown supported; paste or drop images)"
        aria-label="Description"
        className="min-h-32 w-full flex-1 resize-none rounded-md border border-transparent bg-transparent p-2 text-sm outline-none placeholder:text-muted hover:border-border focus:border-accent"
      />
      {editing && (
        // mouseDown is prevented so the textarea keeps focus (a blur would save and leave edit mode).
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void pickImage()} className="mt-1 flex items-center gap-1 self-start rounded-sm px-1.5 py-1 text-xs text-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">
          <ImagePlus size={14} /> Add image
        </button>
      )}
    </div>
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
      <Reorderable ids={kids.map((k) => k.task.id)} onMove={(id, to) => reorderTask(id, to, kids.map((k) => k.task.id))}>
        {kids.map((k) => (
          <SortableItem key={k.task.id} id={k.task.id} label={k.task.title} className="py-1">
            <TaskCheckbox status={k.task.status} priority={k.task.priority} onToggle={() => toggleDone(k.task.id, k.key)} label={`Complete ${k.task.title}`} size={16} />
            <button type="button" onClick={() => openTask(k.task.id, k.key)} className={`flex-1 truncate text-left text-sm ${k.task.status !== "open" ? "text-muted line-through" : ""}`}>
              {k.task.title}
            </button>
            <button type="button" aria-label={`Delete ${k.task.title}`} title="Delete subtask" onClick={() => void deleteTasks([k.task.id], k.key)} className="grid size-6 place-items-center rounded-sm text-muted opacity-0 hover:text-danger focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent group-hover:opacity-100">
              <Trash2 size={13} />
            </button>
          </SortableItem>
        ))}
      </Reorderable>
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
      <Reorderable ids={items.map((i) => i.id)} onMove={(id, to) => set(arrayMove(items, items.findIndex((i) => i.id === id), to))}>
        {items.map((it) => (
          <SortableItem key={it.id} id={it.id} label={it.title} className="py-0.5">
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
          </SortableItem>
        ))}
      </Reorderable>
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

/**
 * Drag-to-reorder for the drawer's subtasks and checklist. A DndContext of its own, so these
 * drags never reach the app's drop targets (lists, calendar, matrix).
 */
function Reorderable({ ids, onMove, children }: { ids: string[]; onMove: (id: string, toIndex: number) => void; children: ReactNode }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const end = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onMove(String(active.id), ids.indexOf(String(over.id)));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={end}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="space-y-0.5">{children}</ul>
      </SortableContext>
    </DndContext>
  );
}

/** A row with a grip handle (pointer or Space + arrows); the rest of the row stays clickable and editable. */
function SortableItem({ id, label, className, children }: { id: string; label: string; className: string; children: ReactNode }) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined, transition }}
      className={`anim-rise group flex items-center gap-1.5 rounded-sm pr-1 hover:bg-hover ${className} ${isDragging ? "relative z-10 bg-surface shadow-md" : ""}`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${label}`}
        title="Drag to reorder"
        className="grid h-6 w-4 shrink-0 cursor-grab touch-none place-items-center rounded text-muted opacity-0 hover:text-fg focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100"
      >
        <GripVertical size={13} />
      </button>
      {children}
    </li>
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
    <details className="border-t border-border pt-3">
      <summary className="cursor-pointer rounded-sm text-xs font-semibold uppercase tracking-wider text-muted hover:text-fg">Activity</summary>
      <ul className="mt-2 space-y-1 text-xs text-muted">
        {items.filter((a) => a.kind !== "created").map((a) => (
          <li key={a.id}>
            <span className="font-mono">{format(new Date(a.at), "MMM d, HH:mm")}</span> · {ACTIVITY_TEXT[a.kind]} {a.detail}
          </li>
        ))}
        <li>
          <span className="font-mono">{format(new Date(task.createdAt), "MMM d, HH:mm")}</span> · Created
        </li>
      </ul>
    </details>
  );
}
