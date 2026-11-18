import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { HABIT_HEX } from "@core/db/habitRows";
import { addDaysLocal, fromLocalDate, todayLocal } from "@core/domain/dates";
import { bestStreak, completionRate, currentStreak, frequencyLabel, goalLabel, isDone, isScheduled, type Habit, type HabitFrequency, type GoalPeriod, type HabitGoal } from "@core/domain/habits";
import { addHabit, removeHabit, setCheckin, tapCheckin, updateHabit, useHabits, valuesOf } from "@core/stores/habits";
import { useSettings } from "@core/stores/settings";
import { GUTTER, INSET, resolveColor, useColors } from "@/theme";
import { KeyboardScroll } from "@/ui/KeyboardScroll";
import { Button, Card, Field, FieldRow, Label, PageHeader, Segmented, Text } from "@/ui/kit";
import { pickDate } from "@/ui/pickDate";
import { askText, choose, num } from "@/ui/Sheet";
import { useSocial } from "@core/stores/social";
import { chooseBuddies, nameOf } from "@/social/actions";
import { askNotificationPermission } from "@/notify";

type Kind = HabitGoal["kind"];
type Form = { name: string; kind: Kind; n: string; unit: string; period: GoalPeriod; frequency: HabitFrequency; color: string; reminders: string[] };
const KINDS = [
  { value: "once", label: "Once" },
  { value: "count", label: "Count" },
  { value: "amount", label: "Amount" },
  { value: "limit", label: "Limit" },
  { value: "quit", label: "Quit" },
] as const;
const KIND_HINT: Record<Kind, string> = {
  once: "Tap once a day to check in.",
  count: "Tap to add one at a time, like glasses of water.",
  amount: "Type how much, like 5 km.",
  limit: "Stay at or under a cap, like 30 min of social media.",
  quit: "Log a slip when it happens. Every other day counts.",
};
const COLORS = Object.entries(HABIT_HEX).map(([k, hex]) => ({ value: hex, label: k[0].toUpperCase() + k.slice(1) }));
const PERIODS: { value: GoalPeriod; label: string }[] = [
  { value: "day", label: "Per day" },
  { value: "week", label: "Per week" },
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const goalOf = (kind: Kind, n: number, unit: string, period: GoalPeriod = "day"): HabitGoal =>
  kind === "count" || kind === "amount" ? { kind, target: Math.max(1, n), unit, period } : kind === "limit" ? { kind, cap: Math.max(0, n), unit } : kind === "quit" ? { kind } : { kind: "once" };

/** One habit (S7): streaks, the past-year map (tap a day to fix it), and every setting. `new` creates one. */
export default function HabitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const h = useHabits((s) => (id === "new" ? undefined : s.habits[id]));
  const records = useHabits((s) => s.checkins[id]);
  const weekStart = useSettings((s) => s.settings.weekStart);
  const g = h?.goal;
  // Every field shows the store's value unless the user edited it here, so a sync change shows up in untouched fields,
  // and save sends only the edited ones (a whole-habit patch would overwrite remote changes to the rest).
  const base: Form = {
    name: h?.name ?? "",
    kind: g?.kind ?? "once",
    n: String(g && "target" in g ? g.target : g && "cap" in g ? g.cap : 1),
    unit: g && "unit" in g ? g.unit : "",
    period: g && "period" in g ? g.period : "day",
    frequency: h?.frequency ?? { kind: "daily" },
    color: h?.color ?? COLORS[0].value,
    reminders: h?.reminders ?? [],
  };
  const [edits, setEdits] = useState<Partial<Form>>({});
  const { name, kind, n, unit, period, frequency, color, reminders } = { ...base, ...edits };
  const field = <K extends keyof Form>(k: K) => (v: Form[K]) => setEdits((e) => ({ ...e, [k]: v }));
  const [setName, setKind, setN, setUnit, setPeriod, setFrequency, setColor, setReminders] = [field("name"), field("kind"), field("n"), field("unit"), field("period"), field("frequency"), field("color"), field("reminders")];
  const buddyRows = useSocial((s) => s.myBuddies);
  const friends = useSocial((s) => s.friends);
  if (id !== "new" && !h)
    return (
      <View style={{ flex: 1 }}>
        <PageHeader title="Habit" back={{ label: "Habits", onPress: () => router.back() }} />
        <Text variant="secondary" style={{ color: c.fg2, paddingHorizontal: GUTTER }}>
          This habit was deleted.
        </Text>
      </View>
    );

  const save = () => {
    if (!name.trim()) return;
    const patch: Partial<Habit> = { name: name.trim(), goal: goalOf(kind, num(n) || 0, unit.trim(), period), frequency, color, reminders };
    if (!h) addHabit({ ...patch, name: name.trim() });
    else {
      // Only what differs from the stored habit, and only fields the user touched.
      const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => {
        const touched = k === "goal" ? ["kind", "n", "unit", "period"].some((f) => f in edits) : k in edits;
        return touched && JSON.stringify(v) !== JSON.stringify(h[k as keyof Habit]);
      }));
      if (Object.keys(changed).length) updateHabit(h.id, changed);
    }
    router.back();
  };
  const chooseFrequency = async () => {
    const f = await choose<"daily" | "weekdays" | "perWeek">("Repeats", [
      { value: "daily", label: "Every day", selected: frequency.kind === "daily" },
      { value: "weekdays", label: "On certain days", selected: frequency.kind === "weekdays" },
      { value: "perWeek", label: "A number of times a week", selected: frequency.kind === "perWeek" },
    ]);
    if (f === "daily") setFrequency({ kind: "daily" });
    else if (f === "perWeek") {
      const k = await askText("Times a week", { value: frequency.kind === "perWeek" ? String(frequency.count) : "3", confirm: "Save" });
      if (k && num(k) >= 1) setFrequency({ kind: "perWeek", count: Math.min(7, Math.round(num(k))) });
    } else if (f === "weekdays") {
      // Toggle days one at a time until Done.
      let days = frequency.kind === "weekdays" ? frequency.days : [1, 2, 3, 4, 5];
      for (;;) {
        const d = await choose<number>("On these days", [...[1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: d, label: DAYS[d], selected: days.includes(d) })), { value: -1, label: "Done", icon: "check" }]);
        if (d === null || d === -1) break;
        days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
      }
      if (days.length) setFrequency({ kind: "weekdays", days });
    }
  };
  const chooseColor = async () => {
    const v = await choose("Colour", COLORS.map((o) => ({ ...o, color: resolveColor(c, o.value), selected: o.value === color })));
    if (v) setColor(v);
  };
  const chooseReminder = async () => {
    const r = await choose<string>("Reminders", [...reminders.map((t) => ({ value: t, label: t, icon: "x" as const, detail: "Remove" })), { value: "", label: "Add a time…", icon: "plus" }]);
    if (r === null) return;
    if (r) return setReminders(reminders.filter((x) => x !== r));
    const d = await pickDate("time", fromLocalDate(todayLocal()));
    if (d) void askNotificationPermission();
    if (d) setReminders([...new Set([...reminders, `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`])].sort());
  };

  const today = todayLocal();
  const values = valuesOf(records);
  const hex = resolveColor(c, color);
  const weeks = Array.from({ length: 53 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDaysLocal(today, -((52 - w) * 7 + (6 - d)))));
  const fixDay = async (d: string) => {
    if (!h) return;
    if (h.goal.kind === "once") return tapCheckin(h, d);
    const v = await askText(fromLocalDate(d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }), { value: String(values.get(d) ?? 0), confirm: "Save" });
    if (v !== null && !Number.isNaN(num(v))) setCheckin(h.id, d, { value: Math.max(0, num(v)) });
  };
  const rate = h ? completionRate(h, values, addDaysLocal(today, -29), today, today, weekStart) : null;
  const stat = (big: string, small: string) => (
    <View style={{ flex: 1 }}>
      <Text variant="title" style={{ fontVariant: ["tabular-nums"] }}>
        {big}
      </Text>
      <Text variant="meta" style={{ color: c.muted }}>
        {small}
      </Text>
    </View>
  );

  return (
    <KeyboardScroll contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <PageHeader title={h ? h.name : "New habit"} sub={h ? [goalLabel(h.goal), frequencyLabel(h.frequency).toLowerCase()].filter(Boolean).join(" · ") : undefined} back={{ label: "Habits", onPress: () => router.back() }} />
      {h ? (
        <>
          <View style={s.stats}>
            {stat(String(currentStreak(h, values, today, weekStart).count), `${currentStreak(h, values, today, weekStart).unit} streak`)}
            {stat(String(bestStreak(h, values, today, weekStart).count), "best streak")}
            {stat(rate === null ? "–" : `${Math.round(rate * 100)}%`, "last 30 days")}
          </View>
          <Label inset>Past year</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentOffset={{ x: 10000, y: 0 }} contentContainerStyle={{ paddingHorizontal: GUTTER }}>
            <View style={{ flexDirection: "row", gap: 3 }}>
              {weeks.map((wk, i) => (
                <View key={i} style={{ gap: 3 }}>
                  {wk.map((d) => {
                    const on = d <= today && d >= h.startDate && isScheduled(h, d);
                    const ok = on && values.has(d) && isDone(h, values.get(d));
                    return <Pressable key={d} disabled={!on} onPress={() => void fixDay(d)} accessibilityLabel={`${d}, ${ok ? "kept" : "missed"}`} hitSlop={2} style={[s.cell, { backgroundColor: ok ? hex : on ? c.surface2 : "transparent" }]} />;
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
          <Text variant="meta" style={{ color: c.muted, paddingHorizontal: GUTTER, paddingTop: 8 }}>
            Tap a day to fix its check-in.
          </Text>
        </>
      ) : null}

      <Label inset>Name</Label>
      <View style={{ paddingHorizontal: INSET }}>
        <Field value={name} onChangeText={setName} placeholder="Drink water" autoFocus={!h} />
      </View>
      <Label inset>Goal</Label>
      <View style={{ paddingHorizontal: INSET, gap: 10 }}>
        <Segmented value={kind} options={KINDS} onChange={setKind} />
        <Text variant="meta" style={{ color: c.muted }}>
          {KIND_HINT[kind]}
        </Text>
        {kind === "count" || kind === "amount" || kind === "limit" ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Field value={n} onChangeText={setN} keyboardType="decimal-pad" style={{ flex: 1 }} accessibilityLabel={kind === "limit" ? "Most per day" : "Target per day"} />
            <Field value={unit} onChangeText={setUnit} placeholder="glasses, min, km" style={{ flex: 2 }} accessibilityLabel="Unit" />
          </View>
        ) : null}
        {kind === "count" || kind === "amount" ? (
          <Segmented value={period} options={PERIODS} onChange={setPeriod} />
        ) : null}
      </View>
      <Card style={{ marginTop: 20 }}>
        <FieldRow first icon="repeat" title="Repeats" value={frequencyLabel(frequency)} onPress={() => void chooseFrequency()} />
        <FieldRow icon="bell" title="Reminder" value={reminders.join(", ") || "None"} onPress={() => void chooseReminder()} />
        {h ? (
          <FieldRow
            icon="users"
            title="Buddies"
            value={buddyRows.filter((b) => b.habitId === h.id).map((b) => { const f = friends.find((x) => x.id === b.buddyId); return f ? nameOf(f) : b.handle ? `@${b.handle}` : "a friend"; }).join(", ") || "None"}
            onPress={() => void chooseBuddies(h)}
          />
        ) : null}
        <FieldRow icon="droplet" title="Colour" value={COLORS.find((o) => o.value === color)?.label ?? "Custom"} valueColor={hex} onPress={() => void chooseColor()} />
      </Card>
      <View style={{ paddingHorizontal: INSET, paddingTop: 20, gap: 10 }}>
        <Button label={h ? "Save" : "Add habit"} onPress={save} disabled={!name.trim()} />
        {h ? (
          <>
            <Button label={h.archived ? "Unarchive habit" : "Archive habit"} kind="outline" icon="archive" onPress={() => (updateHabit(h.id, { archived: !h.archived }), router.back())} />
            <Button
              label="Delete habit"
              icon="trash-2"
              kind="outline"
              onPress={() =>
                Alert.alert(`Delete “${h.name}”?`, "Its whole history is deleted too. Archive keeps it.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: () => (removeHabit(h.id), router.back()) },
                ])
              }
            />
          </>
        ) : null}
      </View>
    </KeyboardScroll>
  );
}

const s = StyleSheet.create({
  stats: { flexDirection: "row", paddingHorizontal: GUTTER, paddingTop: 12, gap: 12 },
  cell: { width: 12, height: 12, borderRadius: 2 },
});
