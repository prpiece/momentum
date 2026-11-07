import { X } from "lucide-react";
import { dismissToast, useUi } from "../../stores/ui";

export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="layer layer-raised toast anim-rise pointer-events-auto"
        >
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.run();
                dismissToast(t.id);
              }}
              className="btn btn-ghost btn-sm toast-act"
            >
              {t.action.label}
            </button>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="btn btn-ghost btn-sm icon-btn text-muted">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
