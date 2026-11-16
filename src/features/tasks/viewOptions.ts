import { defaultViewOptions } from "../../domain/settings";
import { SMART_LISTS, type ViewId, type ViewOptions } from "../../domain/types";
import { trackDone, useSettings } from "../../stores/settings";
import { go, useUi } from "../../stores/ui";

export const isTaskView = (v: ViewId) => (SMART_LISTS as readonly string[]).includes(v) || /^(list|tag|filter):/.test(v);

export const viewOptionsOf = (view: ViewId, all: Record<string, ViewOptions>): ViewOptions => all[view] ?? defaultViewOptions(view);

export function setViewOptions(view: ViewId, patch: Partial<ViewOptions>) {
  const { settings, update } = useSettings.getState();
  update({ viewOptions: { ...settings.viewOptions, [view]: { ...viewOptionsOf(view, settings.viewOptions), ...patch } } });
  if (patch.mode === "matrix") trackDone("view:matrix");
}

/** Today and Upcoming keep their own Manual order, since their tasks come from many lists (D331). */
export const isDayView = (v: string) => v === "today" || v === "upcoming";

export function setManualOrder(view: ViewId, ids: string[]) {
  const { settings, update } = useSettings.getState();
  update({ manualOrder: { ...settings.manualOrder, [view]: ids } });
}

/** `G M`, the palette and voice: the current task view in Matrix mode, or Today when elsewhere (D164). */
export function showInCurrentView(patch: Partial<ViewOptions>) {
  const view = useUi.getState().view;
  const target = isTaskView(view) ? view : "today";
  setViewOptions(target, patch);
  go(target);
}
