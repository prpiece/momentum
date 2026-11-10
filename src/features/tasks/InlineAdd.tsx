import { useMemo, useRef, useState, type RefObject } from "react";
import { useTokenSuggest } from "../../components/ui/TokenSuggest";
import type { Task } from "../../domain/types";
import { useData, type NewTask } from "../../stores/data";
import { useSettings } from "../../stores/settings";
import { createFromText } from "./quickAddSubmit";

/** Open list names and tag names for `~`/`#` autocomplete. */
export function useTokenNames() {
  const lists = useData((s) => s.lists);
  const tags = useData((s) => s.tags);
  return useMemo(
    () => ({
      lists: Object.values(lists).filter((l) => !l.archived).sort((a, b) => a.sortOrder - b.sortOrder).map((l) => l.name),
      tags: Object.values(tags).map((t) => t.name).sort((a, b) => a.localeCompare(b)),
    }),
    [lists, tags],
  );
}

/** The `#tag`/`~List` autocomplete for an add input that submits through `createFromText` (D220). */
export function useAddSuggest(text: string, setText: (t: string) => void, input: RefObject<HTMLInputElement | null>, enabled = true) {
  const smartParse = useSettings((s) => s.settings.smartParse) && enabled;
  const names = useTokenNames();
  return useTokenSuggest({ text, setText, input, lists: smartParse ? names.lists : [], tags: smartParse ? names.tags : [] });
}

/**
 * The compact add field of boards, matrix quadrants and the subtask list. It parses the same natural
 * language as the main bar (D220); the view's context arrives as `defaults`, explicit tokens win.
 */
export function InlineAdd(props: { defaults: Partial<NewTask>; placeholder: string; label: string; className: string; position?: "top" | "bottom"; onAdded?: (t: Task) => void }) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const smartParse = useSettings((s) => s.settings.smartParse);
  const ac = useAddSuggest(text, setText, input);
  return (
    <>
      <input
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        {...ac.inputProps}
        onKeyDown={(e) => {
          if (ac.onKeyDown(e)) return;
          if (e.key === "Enter") {
            const t = createFromText(text, props.defaults, smartParse, () => false, "typed", undefined, props.position);
            if (!t) return;
            props.onAdded?.(t);
            setText("");
          }
        }}
        placeholder={props.placeholder}
        aria-label={props.label}
        className={props.className}
      />
      {ac.open && <div className="px-1 pt-1.5">{ac.row}</div>}
    </>
  );
}
