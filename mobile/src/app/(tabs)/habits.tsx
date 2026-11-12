import { router } from "expo-router";
import { useMemo } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { todayLocal } from "@core/domain/dates";
import { currentStreak, frequencyLabel, isDone, isDueToday, targetOf, unitOf, type Habit } from "@core/domain/habits";
import { setCheckin, tapCheckin, useHabits, valuesOf } from "@core/stores/habits";
import { useSettings } from "@core/stores/settings";
import { resolveColor, useColors } from "@/theme";
import { tick } from "@/ui/haptics";
import { Card, Empty, Icon, IconButton, Label, PageHeader, Text } from "@/ui/kit";
import { useQuickAddContext } from "@/ui/QuickAdd";
import { askText } from "@/ui/Sheet";

export const openHabit = (id: string) => router.push({ pathname: "/habit/[id]", params: { id } });

/** Today's habits (S7) in To do and Done, with a check-in control per kind (F5). */
export default function Habits() {
  const c = useColors();
  const habits = useHabits((s) => s.habits);
  const checkins = useHabits((s) => s.checkins);
  const weekStart = useSettings((s) => s.settings.weekStart);
  const today = todayLocal();
  useQuickAddContext({ schedule: { kind: "day", date: today } });
  const { todo, done, notToday } = useMemo(() => {
    const live = Object.values(habits)
      .filter((h) => !h.archived)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const due = live.filter((h) => isDueToday(h, valuesOf(checkins[h.id]), today, weekStart));
    // Limit and quit days are only kept once the day is over, so they stay in To do.
    const isKept = (h: Habit) => h.goal.kind !== "limit" && h.goal.kind !== "quit" && isDone(h, valuesOf(checkins[h.id]).get(today));
    return { todo: due.filter((h) => !isKept(h)), done: due.filter(isKept), notToday: live.filter((h) => !due.includes(h)) };
  }, [habits, checkins, today, weekStart]);
  const total = todo.length + done.length;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
      <PageHeader title="Habits" sub={total ? `${done.length} of ${total} kept today` : undefined} actions={<IconButton icon="plus" label="New habit" onPress={() => openHabit("new")} />} />
      {!total && !notToday.length ? <Empty text="Build, limit or quit a habit" hint="Tap + at the top to start one. Each keeps a streak." /> : null}
      {todo.length ? (
        <>
          <Label inset>To do</Label>
          <Card>
            {todo.map((h, i) => (
              <HabitRow key={h.id} h={h} today={today} first={i === 0} />
            ))}
          </Card>
        </>
      ) : null}
      {done.length ? (
        <>
          <Label inset>Done</Label>
          <Card>
            {done.map((h, i) => (
              <HabitRow key={h.id} h={h} today={today} first={i === 0} />
            ))}
          </Card>
        </>
      ) : null}
      {notToday.length ? (
        <Text variant="secondary" style={{ color: c.muted, paddingHorizontal: 20, paddingTop: 18 }}>
          {`Not today: ${notToday.map((h) => `${h.name} (${frequencyLabel(h.frequency).toLowerCase()})`).join(", ")}`}
        </Text>
      ) : null}
    </ScrollView>
  );
}

function HabitRow({ h, today, first }: { h: Habit; today: string; first: boolean }) {
  const c = useColors();
  const records = useHabits((s) => s.checkins[h.id]);
  const weekStart = useSettings((s) => s.settings.weekStart);
  const values = valuesOf(records);
  const value = values.get(today) ?? 0;
  const done = isDone(h, value);
  const streak = currentStreak(h, values, today, weekStart);
  const color = resolveColor(c, h.color);
  const unit = unitOf(h);
  const g = h.goal;
  const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  const sub =
    g.kind === "once"
      ? frequencyLabel(h.frequency)
      : g.kind === "quit"
        ? streak.count ? `${streak.count} ${streak.unit}${streak.count > 1 ? "s" : ""} without a slip` : value ? `${value} slip${value > 1 ? "s" : ""} today` : "No slips today"
        : g.kind === "limit"
          ? `At most ${n(g.cap)} ${unit} · ${n(value)} used`
          : `${n(value)} of ${n(g.target)} ${unit}`;

  const checkIn = () => (tick(), tapCheckin(h, today));
  const enter = async (title: string) => {
    const v = await askText(title, { value: value ? String(value) : "", placeholder: "0", confirm: "Save" });
    if (v !== null && !Number.isNaN(Number(v))) (tick(), setCheckin(h.id, today, { value: Math.max(0, Number(v)) }));
  };
  const control =
    g.kind === "once" ? (
      <Pressable onPress={checkIn} accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={`Check in ${h.name}`} style={[s.check, { borderColor: done ? color : c.controlBorder, backgroundColor: done ? color : "transparent" }]}>
        {done ? <Icon name="check" color={c.surface} /> : null}
      </Pressable>
    ) : g.kind === "quit" ? (
      <Pressable
        onPress={() =>
          Alert.alert(`Log a slip for ${h.name}?`, "It resets the streak.", [
            { text: "Cancel", style: "cancel" },
            { text: "Log slip", onPress: () => tapCheckin(h, today) },
          ])
        }
        accessibilityRole="button"
        accessibilityLabel={`Log a slip for ${h.name}`}
        style={[s.pill, { borderColor: c.border }]}
      >
        <Text style={{ color: c.fg2, fontSize: 14, fontWeight: "500" }}>Slip</Text>
      </Pressable>
    ) : (
      <Pressable
        onPress={g.kind === "count" ? checkIn : () => void enter(g.kind === "limit" ? `${unit || "Amount"} used today` : `${h.name} today`)}
        onLongPress={() => void enter(`${h.name} today`)}
        accessibilityRole="button"
        accessibilityLabel={g.kind === "count" ? `Add one ${unit}, ${n(value)} of ${n(g.target)}` : `Log ${h.name}, ${n(value)} of ${n(targetOf(h))}`}
        accessibilityHint={g.kind === "count" ? "Press and hold to type a number" : undefined}
        style={[s.pill, { borderColor: g.kind === "limit" && !done ? c.danger : c.border, overflow: "hidden" }]}
      >
        <View style={[StyleSheet.absoluteFill, { backgroundColor: color, opacity: 0.18, width: `${Math.min(100, (value / Math.max(1, targetOf(h))) * 100)}%` }]} />
        <Text style={{ fontSize: 14, fontWeight: "500", fontVariant: ["tabular-nums"] }}>{`${n(value)}/${n(targetOf(h))}`}</Text>
      </Pressable>
    );

  return (
    <Pressable onPress={() => openHabit(h.id)} accessibilityHint="Opens the habit" style={({ pressed }) => [s.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border }, pressed && { backgroundColor: c.surface2 }]}>
      <View style={[s.swatch, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{h.name}</Text>
        <Text variant="meta" style={{ color: c.muted, fontVariant: ["tabular-nums"] }}>
          {sub}
        </Text>
      </View>
      {streak.count && g.kind !== "quit" ? (
        <View style={s.streak} accessibilityLabel={`${streak.count} ${streak.unit} streak`}>
          <Icon name="zap" size={14} color={c.streak} />
          <Text style={{ color: c.streak, fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{streak.unit === "week" ? `${streak.count} wk` : String(streak.count)}</Text>
        </View>
      ) : null}
      {control}
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 68, paddingLeft: 14, paddingRight: 12, paddingVertical: 10 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  streak: { flexDirection: "row", alignItems: "center", gap: 3 },
  check: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  pill: { minWidth: 56, height: 44, paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
