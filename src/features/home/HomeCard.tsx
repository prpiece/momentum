import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

/** One Home panel: a title that opens its section, then the preview. */
export function HomeCard({ title, onOpen, className = "", children }: { title: string; onOpen: () => void; className?: string; children: ReactNode }) {
  return (
    <section className={`card flex flex-col ${className}`} aria-label={title}>
      <div className="card-h">
        <h3>{title}</h3>
        <button type="button" onClick={onOpen} aria-label={`Open ${title}`} className="btn btn-ghost btn-sm icon-btn text-muted">
          <ArrowRight size={16} strokeWidth={1.75} />
        </button>
      </div>
      {children}
    </section>
  );
}

export const Quiet = ({ children }: { children: ReactNode }) => <p className="text-[length:var(--fs-sm)] text-muted">{children}</p>;

/** A tappable preview row. */
export function Row({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-9 w-full items-center gap-2 rounded-control px-2 text-left text-[length:var(--fs-sm)] hover:bg-surface-2">
      {children}
    </button>
  );
}
