import { Hash, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { removeTag, updateTag, useData } from "../../stores/data";
import { confirm } from "../../stores/ui";

/** Rename and delete tags (they no longer live in the sidebar; D51). */
export function TagsSection() {
  const tags = useData((s) => s.tags);
  const sorted = useMemo(() => Object.values(tags).sort((a, b) => a.name.localeCompare(b.name)), [tags]);
  if (!sorted.length) return <p className="text-sm text-muted">No tags yet. Add one with “#name” in quick add.</p>;
  return (
    <ul className="grid gap-1 sm:grid-cols-2">
      {sorted.map((t) => (
        <li key={t.id} className="group flex items-center gap-2 rounded-sm px-2 py-1 hover:bg-hover">
          <Hash size={14} className="shrink-0 text-muted" />
          <input
            key={t.name}
            defaultValue={t.name}
            aria-label={`Rename tag ${t.name}`}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== t.name) updateTag(t.id, { name: v });
              else e.target.value = t.name;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.currentTarget.value = t.name;
                e.currentTarget.blur();
              }
            }}
            className="min-w-0 flex-1 rounded-sm bg-transparent px-1 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            type="button"
            aria-label={`Delete tag ${t.name}`}
            onClick={async () => {
              if (await confirm(`Delete tag “${t.name}”?`, "It is removed from every task.")) removeTag(t.id);
            }}
            className="grid size-6 place-items-center rounded-sm text-muted opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100"
          >
            <Trash2 size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}
