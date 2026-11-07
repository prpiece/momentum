import type { ReactNode } from "react";

/** A page's title block under the toolbar (D198): the title in Bricolage (.t-title), a muted line under it, and anything to its right. */
export function PageHead({ title, lead, sub, children }: { title: string; lead?: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="t-title flex items-center gap-2.5">
          {lead}
          <span className="truncate">{title}</span>
        </h2>
        {sub && <p className="mt-0.5 text-[length:var(--fs-sm)] leading-[var(--lh-sm)] text-muted">{sub}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-3">{children}</div>}
    </header>
  );
}
