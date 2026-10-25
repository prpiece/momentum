import { X } from "lucide-react";
import { dismissToast, useUi } from "../../stores/ui";

export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="anim-rise pointer-events-auto flex items-center gap-3 rounded-md bg-fg py-2 pl-4 pr-2 text-sm text-bg shadow-lg"
        >
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.run();
                dismissToast(t.id);
              }}
              className="rounded-sm px-2 py-1 font-semibold text-bg underline-offset-2 hover:underline"
            >
              {t.action.label}
            </button>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="rounded-sm p-1 opacity-60 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
