import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { format } from "date-fns";
import { Ban, CalendarDays, Check, ChevronRight, Copy, Flag, GripVertical, Hash, ImagePlus, Pin, Plus, Trash2, X } from "lucide-react";
import { ListGlyph } from "../../components/ui/AppIcon";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { IconButton } from "../../components/ui/Dialog";
import { MenuItem, Popover, useMenu } from "../../components/ui/Popover";
import { TaskCheckbox } from "../../components/ui/TaskCheckbox";
import { isTauri } from "../../db/client";
import { loadActivity } from "../../db/repo";
import { importImage, MAX_IMAGE_BYTES, newImageName, writeImage } from "../../lib/appFiles";
import { scheduleForKey, summarizeSchedule } from "../../domain/recurrence";
import { MAX_SUBTASK_DEPTH, PRIORITIES, PRIORITY_LABEL, PRIORITY_VAR, type Activity, type Task } from "../../domain/types";
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
      className={`layer layer-raised ${side === "right" ? "anim-slide-right right-0 border-y-0 border-r-0" : "anim-slide-left left-0 border-y-0 border-l-0"} absolute inset-y-0 z-40 flex w-[clamp(340px,36vw,440px)] max-w-full flex-col max-[719px]:w-full`}
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

  const list = lists[t.listId];
  const icon = (I: typeof Pin) => <I size={16} strokeWidth={1.75} />;
  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-0.5 border-b border-border pl-5 pr-2">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[length:var(--fs-sm)] text-muted">
          <span className="truncate">{list?.name}</span>
          {parent && (
            <>
              <ChevronRight size={14} className="shrink-0" aria-hidden />
              <button type="button" onClick={() => openTask(parent.id)} className="min-w-0 truncate rounded-xs hover:text-fg">
                {parent.title}
              </button>
            </>
          )}
        </nav>
        <div className="flex-1" />
        <IconButton className="btn-sm" label={t.pinned ? "Unpin" : "Pin"} active={t.pinned} onClick={() => set({ pinned: !t.pinned })}>
          {icon(Pin)}
        </IconButton>
        <IconButton className="btn-sm" label="Duplicate" onClick={() => duplicateTask(t.id)}>
          {icon(Copy)}
        </IconButton>
        <IconButton className="btn-sm" label={t.status === "wont_do" ? "Reopen" : "Won't do"} active={t.status === "wont_do"} onClick={() => setWontDo(t.id, key)}>
          {icon(Ban)}
        </IconButton>
        <IconButton className="btn-sm" label="Delete" onClick={() => void deleteTasks([t.id], key)}>
          {icon(Trash2)}
        </IconButton>
        <IconButton className="btn-sm" label="Close" onClick={closeDrawer}>
          {icon(X)}
        </IconButton>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-6 py-5 max-[719px]:px-[var(--gutter)] anim-stagger [&>*]:shrink-0">
        <div className="flex items-start gap-3">
          <div className="pt-1.5">
            <TaskCheckbox status={t.status} priority={t.priority} onToggle={() => toggleDone(t.id, key)} label="Complete" />
          </div>
          <TitleInput task={t} />
        </div>

        {/* Properties (D198): chips under the title, each opening its editor; they wrap instead of clipping. */}
        <div className="flex flex-wrap gap-1.5 pl-[30px]">
          {!parent && (
            <Prop label="List" text={list?.name ?? "None"} value={list ? <><ListGlyph icon={list.icon} color={list.color} size={14} />{list.name}</> : null}>
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
            </Prop>
          )}
          <Prop label="Due" text={summarizeSchedule(shown, t.recurrence?.rule ?? null)} value={shown.kind !== "none" ? <>{icon(CalendarDays)}{summarizeSchedule(shown, t.recurrence?.rule ?? null)}</> : null}>
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
          </Prop>
          <Prop
            label="Priority"
            text={PRIORITY_LABEL[t.priority]}
            value={t.priority ? <><Flag size={16} strokeWidth={1.75} style={{ color: PRIORITY_VAR[t.priority] }} fill={PRIORITY_VAR[t.priority]} />{PRIORITY_LABEL[t.priority]}</> : null}
          >
            {(close) => (
              <div role="menu" aria-label="Priority">
                {[...PRIORITIES].reverse().map((p) => (
                  <MenuItem key={p} active={t.priority === p} icon={<Flag size={16} strokeWidth={1.75} style={{ color: PRIORITY_VAR[p] }} fill={p ? PRIORITY_VAR[p] : "none"} />} onSelect={() => (set({ priority: p }), close())}>
                    {PRIORITY_LABEL[p]}
                  </MenuItem>
                ))}
              </div>
            )}
          </Prop>
          <Prop
            label="Tags"
            text={t.tags.length ? t.tags.map((id) => tags[id]?.name).filter(Boolean).map((n) => `#${n}`).join(" ") : "None"}
            value={t.tags.length ? t.tags.map((id) => tags[id] && `#${tags[id].name}`).filter(Boolean).join(" ") : null}
          >
            {() => (
              <div className="w-72 max-w-full p-3">
                <TagEditor task={t} tags={tags} />
              </div>
            )}
          </Prop>
        </div>

        <Description task={t} />
        <Subtasks task={t} />
        <Checklist task={t} />
        <ActivityLog task={t} />
      </div>

    </>
  );
}

/** One property chip under the title: its value (or its name, muted, when unset); opens its editor in a popover, and focus returns to the chip on close. */
function Prop({ label, text, value, children }: { label: string; text: string; value: ReactNode; children: (close: () => void) => ReactNode }) {
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
        className={`chip h-auto min-h-8 max-w-full gap-1.5 whitespace-normal break-words rounded-control px-2.5 py-1 text-left text-[length:var(--fs-sm)] hover:bg-border max-[719px]:min-h-[var(--touch)] [&>svg]:shrink-0 ${value ? "" : "text-muted"}`}
      >
        {value ?? <><Plus size={14} strokeWidth={1.75} />{label}</>}
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
      className={`field-sizing-content min-h-8 flex-1 resize-none bg-transparent font-[family-name:var(--font-head)] text-[length:var(--fs-xl)] font-semibold leading-[var(--lh-xl)] outline-none focus-visible:outline-none ${task.status !== "open" ? "text-muted line-through" : ""}`}
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
          <span key={id} className="chip">
            #{tags[id].name}
            <button type="button" aria-label={`Remove tag ${tags[id].name}`} onClick={() => updateTask(task.id, { tags: task.tags.filter((x) => x !== id) })} className="chip-x">
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
        className="prose-md min-h-24 cursor-text rounded-control py-1 pl-[30px] pr-1 text-fg-2 hover:bg-surface-2"
      >
        <NoteMarkdown>{task.description}</NoteMarkdown>
      </div>
    );
  return (
    <div className="flex min-h-24 flex-col">
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
        className="field-sizing-content min-h-24 w-full resize-none rounded-control bg-transparent py-1 pl-[30px] pr-1 text-fg-2 outline-none placeholder:text-muted focus-visible:outline-none"
      />
      {editing && (
        // mouseDown is prevented so the textarea keeps focus (a blur would save and leave edit mode).
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void pickImage()} className="btn btn-ghost btn-sm ml-[22px] mt-1 self-start">
          <ImagePlus size={16} strokeWidth={1.75} /> Add image
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
      <h3 className="t-label mb-1 mt-3 pl-0.5 text-muted">
        Subtasks {kids.length > 0 && <span className="tabular-nums">{kids.filter((k) => k.task.status !== "open").length}/{kids.length}</span>}
      </h3>
      <Reorderable ids={kids.map((k) => k.task.id)} onMove={(id, to) => reorderTask(id, to, kids.map((k) => k.task.id))}>
        {kids.map((k) => (
          <SortableItem key={k.task.id} id={k.task.id} label={k.task.title}>
            <TaskCheckbox status={k.task.status} priority={k.task.priority} onToggle={() => toggleDone(k.task.id, k.key)} label={`Complete ${k.task.title}`} size={16} />
            <button type="button" onClick={() => openTask(k.task.id, k.key)} className={`flex-1 truncate text-left text-[length:var(--fs-sm)] ${k.task.status !== "open" ? "text-muted line-through" : ""}`}>
              {k.task.title}
            </button>
            <button type="button" aria-label={`Delete ${k.task.title}`} title="Delete subtask" onClick={() => void deleteTasks([k.task.id], k.key)} className="btn btn-ghost icon-btn size-6 text-muted opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100">
              <Trash2 size={14} strokeWidth={1.75} />
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
          className={addField}
        />
      ) : (
        <p className="mt-1 pl-0.5 text-[length:var(--fs-xs)] text-muted">Subtasks can nest up to {MAX_SUBTASK_DEPTH} levels.</p>
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
      <h3 className="t-label mb-1 mt-3 pl-0.5 text-muted">
        Checklist {items.length > 0 && <span className="tabular-nums">{items.filter((i) => i.done).length}/{items.length}</span>}
      </h3>
      <Reorderable ids={items.map((i) => i.id)} onMove={(id, to) => set(arrayMove(items, items.findIndex((i) => i.id === id), to))}>
        {items.map((it) => (
          <SortableItem key={it.id} id={it.id} label={it.title}>
            <button
              type="button"
              role="checkbox"
              aria-checked={it.done}
              aria-label={it.title}
              onClick={() => set(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))}
              className="check sm"
            >
              <Check strokeWidth={2.75} />
            </button>
            <input
              defaultValue={it.title}
              onBlur={(e) => e.target.value !== it.title && set(items.map((x) => (x.id === it.id ? { ...x, title: e.target.value } : x)))}
              className={`h-7 flex-1 bg-transparent text-[length:var(--fs-sm)] outline-none focus-visible:outline-none ${it.done ? "text-muted line-through" : ""}`}
              aria-label="Checklist item"
            />
            <button type="button" aria-label="Remove item" onClick={() => set(items.filter((x) => x.id !== it.id))} className="btn btn-ghost icon-btn size-6 text-muted opacity-0 focus-visible:opacity-100 group-hover:opacity-100">
              <X size={14} strokeWidth={1.75} />
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
        className={addField}
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
/** The "+ Add subtask" / "+ Add item" field: a quiet row that shows the input focus ring once focused. */
const addField = "mt-1 h-8 w-full rounded-control border border-transparent bg-transparent px-2 text-[length:var(--fs-sm)] outline-none placeholder:text-muted hover:bg-surface-2 focus-visible:border-accent-text focus-visible:bg-surface focus-visible:shadow-[var(--focus-ring-input)] focus-visible:outline-none";

function SortableItem({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined, transition }}
      className={`anim-rise group flex h-[var(--row-compact)] items-center gap-2 rounded-control pr-1 hover:bg-surface-2 ${isDragging ? "relative z-10 bg-surface shadow-float" : ""}`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${label}`}
        title="Drag to reorder"
        className="grid h-6 w-4 shrink-0 cursor-grab touch-none place-items-center rounded-xs text-muted opacity-0 hover:text-fg focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent group-hover:opacity-100"
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
    <details className="mt-3">
      <summary className="t-label cursor-pointer rounded-xs pl-0.5 text-muted hover:text-fg">Activity</summary>
      <ul className="mt-2 space-y-1 pl-0.5 text-[length:var(--fs-sm)] text-muted">
        {items.filter((a) => a.kind !== "created").map((a) => (
          <li key={a.id}>
            <span className="tabular-nums">{format(new Date(a.at), "MMM d, HH:mm")}</span> · {ACTIVITY_TEXT[a.kind]} {a.detail}
          </li>
        ))}
        <li>
          <span className="tabular-nums">{format(new Date(task.createdAt), "MMM d, HH:mm")}</span> · Created
        </li>
      </ul>
    </details>
  );
}
