import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="grid size-16 place-items-center rounded-full bg-accent-soft text-accent">
        <Icon size={28} strokeWidth={1.75} />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <div className="max-w-sm text-sm text-fg-2">{children}</div>}
    </div>
  );
}
