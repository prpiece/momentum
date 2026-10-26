import { IconPicker, ListGlyph } from "../../components/ui/AppIcon";
import { Archive, Check, Pin, Trash2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Button, Dialog } from "../../components/ui/Dialog";
import { ACCENT_PRESETS } from "../../domain/color";
import type { TaskList } from "../../domain/types";
import { addList, removeList, updateList, useData } from "../../stores/data";
import { confirm, go } from "../../stores/ui";


/** Create (no `list`) or edit a list. */
export function ListDialog({ list, onClose, folderId = null }: { list?: TaskList; onClose: () => void; folderId?: string | null }) {
  const folderMap = useData((s) => s.folders);
  const folders = useMemo(() => Object.values(folderMap).sort((a, b) => a.sortOrder - b.sortOrder), [folderMap]);
  const [name, setName] = useState(list?.name ?? "");
  const [icon, setIcon] = useState<string | null>(list?.icon ?? null);
  const [color, setColor] = useState<string | null>(list?.color ?? ACCENT_PRESETS[0].hex);
  const [folder, setFolder] = useState<string | null>(list?.folderId ?? folderId);
  const [tint, setTint] = useState(list?.tint ?? false);

  const save = () => {
    if (!name.trim()) return;
    const patch = { name: name.trim(), icon, color, folderId: folder, tint };
    if (list) updateList(list.id, patch);
    else {
      const l = addList(patch.name, folder);
      updateList(l.id, patch);
      go(`list:${l.id}`);
    }
    onClose();
  };

  return (
    <Dialog label={list ? "Edit list" : "New list"} onClose={onClose}>
      <form
        className="space-y-5 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2 className="text-lg font-semibold">{list ? "Edit list" : "New list"}</h2>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">Name</span>
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 focus-within:border-accent">
            <ListGlyph icon={icon} color={color} size={18} />
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="h-10 flex-1 bg-transparent outline-none" placeholder="e.g. School" />
          </div>
        </label>

        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Color</legend>
          <div className="flex flex-wrap items-center gap-2">
            {ACCENT_PRESETS.map((p) => (
              <button key={p.hex} type="button" aria-label={p.name} aria-pressed={color === p.hex} onClick={() => setColor(p.hex)} className="grid size-7 place-items-center rounded-full" style={{ background: p.hex }}>
                {color === p.hex && <Check size={14} strokeWidth={3} className="text-white" />}
              </button>
            ))}
            <input type="color" aria-label="Custom color" value={color ?? "#888888"} onChange={(e) => setColor(e.target.value)} className="size-7 cursor-pointer rounded-full border border-border bg-transparent" />
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Icon</legend>
          <IconPicker value={icon} onChange={setIcon} color={color ?? undefined} none="Dot" />
        </fieldset>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            Folder
            <select value={folder ?? ""} onChange={(e) => setFolder(e.target.value || null)} className="h-9 rounded-sm border border-border bg-surface px-2 text-sm">
              <option value="">None</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={tint} onChange={(e) => setTint(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            Tint background
          </label>
        </div>

        <div className="flex items-center gap-2 border-t border-border pt-4">
          {list && (
            <>
              <Button title={list.pinned ? "Unpin" : "Pin to top"} onClick={() => (updateList(list.id, { pinned: !list.pinned }), onClose())}>
                <Pin size={15} /> {list.pinned ? "Unpin" : "Pin"}
              </Button>
              <Button onClick={() => (updateList(list.id, { archived: !list.archived }), onClose())}>
                <Archive size={15} /> {list.archived ? "Unarchive" : "Archive"}
              </Button>
              <Button
                variant="ghost"
                className="text-danger"
                onClick={async () => {
                  if (await confirm(`Delete “${list.name}”?`, "The list and all its tasks are deleted permanently.")) {
                    removeList(list.id);
                    go("inbox");
                    onClose();
                  }
                }}
              >
                <Trash2 size={15} />
              </Button>
            </>
          )}
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!name.trim()}>
            {list ? "Save" : "Create list"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ListDialogButton({ list, children, folderId }: { list?: TaskList; children: ReactNode; folderId?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label={list ? "List settings" : "New list"} title={list ? "List settings" : "New list"} onClick={() => setOpen(true)} className="grid size-8 place-items-center rounded-sm text-muted hover:bg-hover hover:text-fg">
        {children}
      </button>
      {open && <ListDialog list={list} folderId={folderId} onClose={() => setOpen(false)} />}
    </>
  );
}
