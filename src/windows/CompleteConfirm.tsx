import { Check } from "lucide-react";
import type { CompleteCandidate } from "../domain/voice";

type Props = {
  candidates: CompleteCandidate[];
  picked: number;
  onPick: (index: number) => void;
  onConfirm: (id: string) => void;
  onCancel: () => void;
};

const BTN = "rounded-control px-2 py-0.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** D95: a spoken "complete ..." always asks first; one match is a yes/no, several are a pick (up to three). */
export function CompleteConfirm({ candidates, picked, onPick, onConfirm, onCancel }: Props) {
  const one = candidates.length === 1;
  return (
    <div className="flex min-h-7 flex-col gap-1 pb-1" role="group" aria-label="Confirm completing a task">
      {one ? (
        <div className="flex items-center gap-2 text-sm">
          <Check size={14} className="text-accent" />
          <span className="min-w-0 flex-1 truncate">Complete “{candidates[0].title}”?</span>
          <button type="button" onClick={() => onConfirm(candidates[0].id)} className={`${BTN} bg-accent text-accent-fg`}>
            Complete
          </button>
          <button type="button" onClick={onCancel} className={`${BTN} text-muted hover:bg-surface-2`}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <span className="text-xs text-muted">Which task did you finish?</span>
          {candidates.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onConfirm(c.id)}
              onMouseEnter={() => onPick(i)}
              aria-current={i === picked}
              className={`flex items-center gap-2 truncate rounded-control px-2 py-1 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent ${i === picked ? "bg-accent-soft" : "hover:bg-surface-2"}`}
            >
              <Check size={14} className={i === picked ? "text-accent" : "text-transparent"} />
              <span className="truncate">{c.title}</span>
            </button>
          ))}
        </>
      )}
      <span className="text-xs text-muted">
        <kbd className="tabular-nums">Enter</kbd> {one ? "complete" : "complete selected"} {one ? "" : "· ↑↓ choose "}· <kbd className="tabular-nums">Esc</kbd> back
      </span>
    </div>
  );
}
