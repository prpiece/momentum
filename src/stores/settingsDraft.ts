import { useCallback, useMemo } from "react";
import { create } from "zustand";
import type { Settings } from "../domain/types";
import { useSettings } from "./settings";

/**
 * Unsaved Settings edits (D232): a patch over the saved settings. The Settings screens read and write this,
 * so nothing (zoom, theme, accent, shortcuts) takes effect until Save. It is a patch, not a copy, so a setting
 * the app changes meanwhile (e.g. Getting started) isn't overwritten when the draft is saved.
 */
const useDraftPatch = create<{ patch: Partial<Settings> }>(() => ({ patch: {} }));

/** The keys of `patch` whose value differs from `saved` (settings are plain JSON, so compare by value). */
export function changedKeys(saved: Settings, patch: Partial<Settings>): Partial<Settings> {
  return Object.fromEntries(Object.entries(patch).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(saved[k as keyof Settings])));
}

export const discardDraft = () => useDraftPatch.setState({ patch: {} });
export function saveDraft() {
  const { settings, update } = useSettings.getState();
  const changed = changedKeys(settings, useDraftPatch.getState().patch);
  if (Object.keys(changed).length) update(changed);
  discardDraft();
}
export const draftIsDirty = () => Object.keys(changedKeys(useSettings.getState().settings, useDraftPatch.getState().patch)).length > 0;

/** `draft` is the settings as edited; `update` edits the draft (same shape as the store's `update`). */
export function useSettingsDraft() {
  const saved = useSettings((s) => s.settings);
  const patch = useDraftPatch((s) => s.patch);
  const draft = useMemo(() => ({ ...saved, ...patch }), [saved, patch]);
  const dirty = useMemo(() => Object.keys(changedKeys(saved, patch)).length > 0, [saved, patch]);
  const update = useCallback((p: Partial<Settings>) => useDraftPatch.setState((s) => ({ patch: { ...s.patch, ...p } })), []);
  return { draft, update, dirty, save: saveDraft, discard: discardDraft };
}
