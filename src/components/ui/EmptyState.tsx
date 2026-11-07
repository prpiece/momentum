import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="empty">
        <span className="eic">
          <Icon size={18} strokeWidth={1.75} />
        </span>
        <h2>{title}</h2>
        {children && <div className="empty-body">{children}</div>}
      </div>
    </div>
  );
}
