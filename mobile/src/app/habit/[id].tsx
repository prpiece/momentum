import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { addDaysLocal, todayLocal } from "@core/domain/dates";
import { bestStreak, currentStreak, isDone, isScheduled, type HabitGoal } from "@core/domain/habits";
import { addHabit, removeHabit, updateHabit, useHabits, valuesOf } from "@core/stores/habits";
import { useSettings } from "@core/stores/settings";
import { resolveColor, useColors } from "@/theme";
import { Button, Field, Label, Segmented } from "@/ui/kit";

type Kind = HabitGoal["kind"];
const KINDS = [
  { value: "once", label: "Once" },
  { value: "count", label: "Count" },
  { value: "limit", label: "Limit" },
  { value: "quit", label: "Quit" },
] as const;

const goalOf = (kind: Kind, n: number, unit: string): HabitGoal =>
  kind === "count" ? { kind, target: Math.max(1, n), unit } : kind === "amount" ? { kind, target: Math.max(1, n), unit } : kind === "limit" ? { kind, cap: Math.max(0, n), unit } : kind === "quit" ? { kind } : { kind: "once" };

/** One habit: the past-year map, streaks, and its name and goal. `new` creates one. */
export default function HabitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const h = useHabits((s) => (id === "new" ? undefined : s.habits[id]));
  const records = useHabits((s) => s.checkins[id]);
  const weekStart = useSettings((s) => s.settings.weekStart);
  const [name, setName] = useState(h?.name ?? "");
  const [kind, setKind] = useState<Kind>(h?.goal.kind ?? "once");
  const g = h?.goal;
  const [n, setN] = useState(String(g && "target" in g ? g.target : g && "cap" in g ? g.cap : 1));
  const [unit, setUnit] = useState(g && "unit" in g ? g.unit : "");
  if (id !== "new" && !h) return <Text style={{ color: c.muted, padding: 16 }}>This habit was deleted.</Text>;

  const save = () => {
    if (!name.trim()) return;
    const goal = goalOf(kind, Number(n) || 0, unit.trim());
    if (h) updateHabit(h.id, { name: name.trim(), goal });
    else addHabit({ name: name.trim(), goal });
    router.back();
  };

  const today = todayLocal();
  const values = valuesOf(records);
  const color = h ? resolveColor(c, h.color) : c.accent;
  // 53 weeks, oldest first, one column per week.
  const weeks = Array.from({ length: 53 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDaysLocal(today, -((52 - w) * 7 + (6 - d)))));

  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: h ? h.name : "New habit" }} />
      {h ? (
        <>
          <Text style={{ color: c.fg2, fontSize: 15 }}>
            Current streak {currentStreak(h, values, today, weekStart).count} · Best {bestStreak(h, values, today, weekStart).count}
          </Text>
          <Label>Past year</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentOffset={{ x: 10000, y: 0 }}>
            <View style={{ flexDirection: "row", gap: 2 }}>
              {weeks.map((wk, i) => (
                <View key={i} style={{ gap: 2 }}>
                  {wk.map((d) => {
                    const on = d <= today && d >= h.startDate && isScheduled(h, d);
                    const ok = on && values.has(d) && isDone(h, values.get(d));
                    return <View key={d} style={[s.cell, { backgroundColor: ok ? color : on ? c.surface2 : "transparent" }]} />;
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        </>
      ) : null}
      <Label>Name</Label>
      <Field value={name} onChangeText={setName} placeholder="Drink water" autoFocus={!h} />
      <Label>Goal</Label>
      <Segmented value={kind === "amount" ? "count" : kind} options={KINDS} onChange={setKind} />
      {kind === "count" || kind === "amount" || kind === "limit" ? (
        <View style={[s.row, { marginTop: 12 }]}>
          <Field value={n} onChangeText={setN} keyboardType="number-pad" style={{ flex: 1 }} accessibilityLabel={kind === "limit" ? "Most per day" : "Target per day"} />
          <Field value={unit} onChangeText={setUnit} placeholder="unit (glasses, min)" style={{ flex: 2 }} />
        </View>
      ) : null}
      <View style={{ height: 16 }} />
      <Button label={h ? "Save" : "Add habit"} onPress={save} disabled={!name.trim()} />
      {h ? (
        <>
          <View style={{ height: 24 }} />
          <Button
            label="Delete habit"
            icon="trash-2"
            kind="danger"
            onPress={() =>
              Alert.alert(`Delete “${h.name}”?`, "Its whole history is deleted too.", [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: () => (removeHabit(h.id), router.back()) },
              ])
            }
          />
        </>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, paddingBottom: 48 },
  row: { flexDirection: "row", gap: 8 },
  cell: { width: 11, height: 11, borderRadius: 2 },
});
