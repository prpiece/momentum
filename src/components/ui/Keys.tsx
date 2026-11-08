import { keyParts } from "../../domain/keys";
import { keyLabel } from "../../lib/platform";

/** A key binding as keycaps (.kbd), one per key, with "/" and "or" between alternatives as text (D198). */
export function Keys({ keys, title }: { keys: string; title?: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap" title={title}>
      {keyParts(keyLabel(keys)).map((p, i) =>
        p.kind === "key" ? (
          <kbd key={i} className="kbd">
            {p.value}
          </kbd>
        ) : (
          <span key={i} className="text-[length:var(--fs-xs)] text-muted">
            {p.value}
          </span>
        ),
      )}
    </span>
  );
}
