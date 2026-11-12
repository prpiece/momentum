import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { fromLocalDate, relativeDayLabel, toLocalDate, todayLocal } from "@core/domain/dates";
import { parseQuickAdd } from "@core/domain/quickAdd";
import { INBOX_ID, PRIORITY_LABEL, PRIORITY_VAR, type Priority } from "@core/domain/types";
import { useData, type NewTask } from "@core/stores/data";
import { createFromText, listNames } from "@core/stores/quickAddSubmit";
import { create } from "zustand";
import { FONTS, resolveColor, useColors } from "@/theme";
import { tick } from "./haptics";
import { Icon, Text, type IconName } from "./kit";
import { pickDate } from "./pickDate";
import { choose, Sheet } from "./Sheet";

type Defaults = Partial<NewTask>;
/** Where the + puts a task: the screen in front says (Today → today, a list → that list, D220). The draft survives a dismiss. */
const useQuickAdd = create<{ open: boolean; context: Defaults; draft: string }>(() => ({ open: false, context: {}, draft: "" }));
export const openQuickAdd = () => useQuickAdd.setState({ open: true });
/** Call in a screen to make it the + sheet's context while it's focused. */
export function useQuickAddContext(context: Defaults) {
  const key = JSON.stringify(context);
  useFocusEffect(useCallback(() => useQuickAdd.setState({ context: JSON.parse(key) as Defaults }), [key]));
}

/** The one capture sheet, opened by the tab bar's +. Return adds and keeps the sheet open for the next task (F1). */
export function QuickAddHost() {
  const c = useColors();
  const { open, context, draft } = useQuickAdd();
  const lists = useData((s) => s.lists);
  // Tool-row choices override the screen's defaults; typed tokens still win over both (withDefaults).
  const [over, setOver] = useState<Defaults>({});
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const defaults = { ...context, ...over };
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => input.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [open]);
  const parsed = useMemo(() => (draft.trim() ? parseQuickAdd(draft, new Date(), true, listNames()) : null), [draft]);
  const setDraft = (draft: string) => useQuickAdd.setState({ draft });
  const close = () => (useQuickAdd.setState({ open: false }), setOver({}));
  const add = () => {
    if (!createFromText(draft, defaults, true, () => false)) return;
    tick();
    setDraft("");
    setOver({});
  };

  const listId = parsed?.listName ? undefined : defaults.listId;
  const date = defaults.schedule && defaults.schedule.kind !== "none" ? (defaults.schedule.kind === "timed" ? toLocalDate(new Date(defaults.schedule.start)) : defaults.schedule.date) : null;
  type Chip = { key: string; label: string; icon?: IconName; color?: string; remove: () => void; hint: string };
  const chips: Chip[] = [
    ...(parsed?.chips ?? []).map((ch) => ({
      key: `${ch.kind}${ch.start}`,
      label: ch.kind === "tag" ? `#${ch.value ?? ch.text.replace(/^#/, "")}` : ch.text,
      icon: ch.kind === "date" ? ("calendar" as const) : ch.kind === "priority" ? ("flag" as const) : ch.kind === "repeat" ? ("repeat" as const) : undefined,
      remove: () => setDraft((draft.slice(0, ch.start) + draft.slice(ch.end)).replace(/ {2,}/g, " ")),
      hint: "Removes it from the task",
    })),
    ...(date && !parsed?.chips.some((ch) => ch.kind === "date") ? [{ key: "d", label: relativeDayLabel(date, todayLocal()), icon: "calendar" as const, remove: () => setOver({ ...over, schedule: { kind: "none" } }), hint: "Removes the date" }] : []),
    ...(over.priority && !parsed?.chips.some((ch) => ch.kind === "priority") ? [{ key: "p", label: PRIORITY_LABEL[over.priority], icon: "flag" as const, color: resolveColor(c, PRIORITY_VAR[over.priority]), remove: () => setOver({ ...over, priority: 0 }), hint: "Removes the priority" }] : []),
    ...(listId && listId !== INBOX_ID && lists[listId] ? [{ key: "l", label: lists[listId].name, icon: "list" as const, remove: () => setOver({ ...over, listId: INBOX_ID }), hint: "Adds it to the Inbox instead" }] : []),
  ];

  const tools: { icon: IconName; label: string; run: () => void }[] = [
    {
      icon: "calendar",
      label: "Set date",
      run: async () => {
        const picked = await pickDate("date", date ? fromLocalDate(date) : new Date());
        if (picked) setOver({ ...over, schedule: { kind: "day", date: toLocalDate(picked) } });
      },
    },
    {
      icon: "flag",
      label: "Set priority",
      run: async () => {
        const p = await choose<Priority>("Priority", ([3, 2, 1, 0] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p], icon: "flag", color: p ? resolveColor(c, PRIORITY_VAR[p]) : c.muted, selected: (defaults.priority ?? 0) === p })));
        if (p !== null) setOver({ ...over, priority: p });
      },
    },
    {
      icon: "list",
      label: "Choose list",
      run: async () => {
        const options = Object.values(lists)
          .filter((l) => !l.archived)
          .sort((a, b) => Number(b.id === INBOX_ID) - Number(a.id === INBOX_ID) || a.sortOrder - b.sortOrder)
          .map((l) => ({ value: l.id, label: l.name, color: l.id === INBOX_ID ? undefined : resolveColor(c, l.color, c.muted), icon: l.id === INBOX_ID ? ("inbox" as const) : undefined, selected: (defaults.listId ?? INBOX_ID) === l.id }));
        const id = await choose("List", options);
        if (id) setOver({ ...over, listId: id });
      },
    },
    { icon: "hash", label: "Add tag", run: () => (setDraft(`${draft.trimEnd()}${draft.trim() ? " " : ""}#`), input.current?.focus()) },
  ];

  return (
    <Sheet visible={open} onClose={close} label="Add a task">
      <View style={s.body}>
        <TextInput
          ref={input}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          submitBehavior="submit"
          returnKeyType="done"
          placeholder="Call mum tomorrow 6pm !high"
          placeholderTextColor={c.muted}
          accessibilityLabel="Task"
          maxFontSizeMultiplier={2}
          style={[s.input, { color: c.fg }]}
        />
        {chips.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={s.chips}>
            {chips.map((ch) => (
              <Pressable key={ch.key} onPress={ch.remove} accessibilityRole="button" accessibilityLabel={`${ch.label}. ${ch.hint}`} style={[s.chip, { backgroundColor: c.accentSoft }]}>
                {ch.icon ? <Icon name={ch.icon} size={14} color={ch.color ?? c.fg} /> : null}
                <Text style={{ fontSize: 14, fontWeight: "500", color: ch.color ?? c.fg }}>{ch.label}</Text>
                <Icon name="x" size={12} color={c.muted} />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>
      <View style={[s.tools, { borderColor: c.border }]}>
        {tools.map((t) => (
          <Pressable key={t.icon} onPress={t.run} accessibilityRole="button" accessibilityLabel={t.label} style={({ pressed }) => [s.tool, pressed && { backgroundColor: c.surface2 }]}>
            <Icon name={t.icon} color={c.fg2} />
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <Pressable onPress={add} disabled={!draft.trim()} accessibilityRole="button" accessibilityLabel="Add task" style={[s.send, { backgroundColor: c.accent, opacity: draft.trim() ? 1 : 0.4 }]}>
          <Icon name="arrow-up" size={22} color={c.accentFg} />
        </Pressable>
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 4 },
  input: { fontSize: 18, lineHeight: 26, minHeight: 52, paddingHorizontal: 4, fontFamily: FONTS[400] },
  chips: { gap: 8, paddingVertical: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: 10, borderRadius: 6 },
  tools: { flexDirection: "row", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingTop: 4, marginTop: 4 },
  tool: { width: 44, height: 44, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", marginRight: 8 },
});
