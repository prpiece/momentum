import { defaultViewOptions } from "../../domain/settings";
import { SMART_LISTS, type ViewId, type ViewOptions } from "../../domain/types";
import { useSettings } from "../../stores/settings";
import { go, useUi } from "../../stores/ui";

export const isTaskView = (v: ViewId) => (SMART_LISTS as readonly string[]).includes(v) || /^(list|tag|filter):/.test(v);

export const viewOptionsOf = (view: ViewId, all: Record<string, ViewOptions>): ViewOptions => all[view] ?? defaultViewOptions(view);

export function setViewOptions(view: ViewId, patch: Partial<ViewOptions>) {
  const { settings, update } = useSettings.getState();
  update({ viewOptions: { ...settings.viewOptions, [view]: { ...viewOptionsOf(view, settings.viewOptions), ...patch } } });
}

/** `G M`, the palette and voice: the current task view in Matrix mode, or Today when elsewhere (D164). */
export function showInCurrentView(patch: Partial<ViewOptions>) {
  const view = useUi.getState().view;
  const target = isTaskView(view) ? view : "today";
  setViewOptions(target, patch);
  go(target);
}
