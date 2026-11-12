import { router, type Href } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { setLocalState, state as localState, useSync } from "@core/lib/sync/engine";
import { useData } from "@core/stores/data";
import { useHabits } from "@core/stores/habits";
import { INSET, useColors } from "@/theme";
import { Icon, Text } from "./kit";

/** Today's checklist after onboarding (S14): done as you use the app, dismissible. Shown only to phones set up through onboarding. */
export function GettingStarted() {
  const c = useColors();
  const [show, setShow] = useState(false);
  useEffect(() => {
    void Promise.all([localState("onboarded"), localState("gettingStarted")]).then(([o, g]) => setShow(o === "new" && g !== "dismissed"));
  }, []);
  const tasks = useData((s) => s.tasks);
  const habits = useHabits((s) => s.habits);
  const account = useSync((s) => s.account);
  const items = useMemo(() => {
    const all = Object.values(tasks).filter((t) => !t.deletedAt);
    return [
      { title: "Add a task", hint: "Tap + and type it the way you'd say it.", done: all.length > 0, href: null },
      { title: "Start a habit", hint: "Habits keep a streak beside your tasks.", done: Object.keys(habits).length > 0, href: "/habits" },
      { title: "Complete a task", hint: "Tap its circle, or swipe the row right.", done: all.some((t) => t.status !== "open"), href: null },
      { title: "Plan it in the calendar", hint: "Press and hold a task to move it to a time.", done: all.some((t) => t.schedule.kind === "timed"), href: "/calendar" },
      { title: "Sync with your computer", hint: "Optional. Sign in to share tasks with desktop.", done: !!account, href: "/account" },
    ] satisfies { title: string; hint: string; done: boolean; href: Href | null }[];
  }, [tasks, habits, account]);
  const count = items.filter((i) => i.done).length;
  if (!show || count === items.length) return null;
  const dismiss = () => (setShow(false), void setLocalState("gettingStarted", "dismissed"));
  return (
    <View style={[s.card, { borderColor: c.border, backgroundColor: c.surface }]}>
      <View style={s.head}>
        <Text variant="bodyStrong" style={{ flex: 1, fontWeight: "600" }}>
          Getting started
        </Text>
        <Text style={{ color: c.muted, fontSize: 13, fontVariant: ["tabular-nums"] }}>
          {count} of {items.length}
        </Text>
        <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel="Dismiss Getting started" style={s.close}>
          <Icon name="x" size={18} color={c.muted} />
        </Pressable>
      </View>
      {items.map((i) => (
        <Pressable key={i.title} disabled={!i.href} onPress={() => i.href && router.push(i.href)} accessibilityRole={i.href ? "button" : "text"} accessibilityState={{ checked: i.done }} style={s.item}>
          <View style={[s.check, { borderColor: i.done ? c.success : c.controlBorder, backgroundColor: i.done ? c.success : "transparent" }]}>{i.done ? <Icon name="check" size={12} color={c.surface} /> : null}</View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: "500", color: i.done ? c.muted : c.fg, textDecorationLine: i.done ? "line-through" : "none" }}>{i.title}</Text>
            {i.done ? null : (
              <Text variant="meta" style={{ color: c.muted }}>
                {i.hint}
              </Text>
            )}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginHorizontal: INSET, marginTop: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 14, paddingBottom: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -12 },
  item: { flexDirection: "row", gap: 12, alignItems: "flex-start", paddingVertical: 8, minHeight: 44 },
  check: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: 1 },
});
