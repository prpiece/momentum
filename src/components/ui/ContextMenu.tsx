import { useEffect, useRef } from "react";
import { closeContextMenu, useUi } from "../../stores/ui";
import { MenuItem, MenuSeparator, Popover } from "./Popover";

/** The one right-click menu. Components fill it with `openContextMenu(e, items)`. */
export function ContextMenu() {
  const menu = useUi((s) => s.contextMenu);
  const box = useRef<HTMLDivElement>(null);

  // Suppress the webview's own menu (Reload / Inspect) except where text editing needs it.
  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("input, textarea, [contenteditable=true]")) e.preventDefault();
    };
    document.addEventListener("contextmenu", onMenu);
    return () => document.removeEventListener("contextmenu", onMenu);
  }, []);

  useEffect(() => {
    if (menu) box.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [menu]);

  if (!menu) return null;
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(box.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return (
    <Popover anchor={menu} onClose={closeContextMenu} className="min-w-52">
      <div ref={box} role="menu" onKeyDown={move}>
        {menu.items.map((it, i) =>
          it === "sep" ? (
            <MenuSeparator key={i} />
          ) : "choices" in it ? (
            <div key={i} className="flex items-center gap-1 px-2.5 py-1">
              <span className="flex-1 text-xs text-muted">{it.label}</span>
              {it.choices.map((c) => (
                <button
                  key={c.title}
                  type="button"
                  role="menuitem"
                  title={c.title}
                  aria-label={c.title}
                  onClick={() => {
                    closeContextMenu();
                    c.run();
                  }}
                  className={`grid size-7 place-items-center rounded-sm text-fg-2 transition-colors hover:bg-hover hover:text-fg ${c.active ? "bg-accent-soft text-accent" : ""}`}
                >
                  {c.icon}
                </button>
              ))}
            </div>
          ) : (
            <MenuItem
              key={i}
              icon={it.icon}
              danger={it.danger}
              hint={it.hint}
              onSelect={() => {
                closeContextMenu();
                it.run();
              }}
            >
              {it.label}
            </MenuItem>
          ),
        )}
      </div>
    </Popover>
  );
}
