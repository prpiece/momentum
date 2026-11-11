import { router, Tabs } from "expo-router";
import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { todayLocal } from "@core/domain/dates";
import { currentStreak, goalLabel, isDone, isScheduled, unitOf, type Habit } from "@core/domain/habits";
import { tapCheckin, useHabits, valuesOf } from "@core/stores/habits";
import { useSettings } from "@core/stores/settings";
import { resolveColor, useColors } from "@/theme";
import { Empty, Icon } from "@/ui/kit";

const openHabit = (id: string) => router.push({ pathname: "/habit/[id]", params: { id } });

/** Today's habits: tap to check in (once), or −/+ for counts, amounts, limits and slips. */
export default function Habits() {
  const c = useColors();
  const habits = useHabits((s) => s.habits);
  const today = todayLocal();
  const list = useMemo(
    () =>
      Object.values(habits)
        .filter((h) => !h.archived && (h.frequency.kind === "perWeek" || isScheduled(h, today)))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [habits, today],
  );
  return (
    <>
      <Tabs.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => openHabit("new")} hitSlop={8} accessibilityLabel="New habit" style={{ padding: 12 }}>
              <Icon name="plus" color={c.accentText} size={24} />
            </Pressable>
          ),
        }}
      />
      <FlatList data={list} keyExtractor={(h) => h.id} ListEmptyComponent={<Empty text="No habits for today. Tap + to add one." />} renderItem={({ item }) => <HabitRow h={item} today={today} />} />
    </>
  );
}

function HabitRow({ h, today }: { h: Habit; today: string }) {
  const c = useColors();
  const records = useHabits((s) => s.checkins[h.id]);
  const weekStart = useSettings((s) => s.settings.weekStart);
  const values = valuesOf(records);
  const value = values.get(today) ?? 0;
  const done = isDone(h, value);
  const streak = currentStreak(h, values, today, weekStart);
  const color = resolveColor(c, h.color);
  const once = h.goal.kind === "once";
  const amount = h.goal.kind === "quit" ? (value ? `${value} slip${value > 1 ? "s" : ""}` : "No slips") : h.goal.kind === "once" ? "" : `${value} / ${h.goal.kind === "limit" ? h.goal.cap : h.goal.target} ${unitOf(h)}`;
  const avoid = h.goal.kind === "limit" || h.goal.kind === "quit";

  return (
    <Pressable onPress={() => openHabit(h.id)} style={({ pressed }) => [s.row, { borderColor: c.border, backgroundColor: pressed ? c.surface2 : "transparent" }]}>
      <View style={s.text}>
        <Text style={{ color: c.fg, fontSize: 16, fontWeight: "500" }}>{h.name}</Text>
        <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>{[amount, goalLabel(h.goal), streak.count ? `${streak.count} ${streak.unit}${streak.count > 1 ? "s" : ""} streak` : null].filter(Boolean).join("  ·  ")}</Text>
      </View>
      {once ? (
        <Pressable onPress={() => tapCheckin(h, today)} hitSlop={10} accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={`Check in ${h.name}`} style={[s.check, { borderColor: color, backgroundColor: done ? color : "transparent" }]}>
          {done ? <Icon name="check" color="#FFFFFF" size={18} /> : null}
        </Pressable>
      ) : (
        <View style={s.stepper}>
          <Pressable onPress={() => tapCheckin(h, today, -1)} disabled={!value} hitSlop={6} accessibilityLabel={`Less ${h.name}`} style={[s.step, { backgroundColor: c.surface2, opacity: value ? 1 : 0.4 }]}>
            <Icon name="minus" color={c.fg} size={18} />
          </Pressable>
          <Pressable onPress={() => tapCheckin(h, today, 1)} hitSlop={6} accessibilityLabel={avoid ? `Log ${h.name}` : `More ${h.name}`} style={[s.step, { backgroundColor: done && !avoid ? color : c.surface2 }]}>
            <Icon name="plus" color={done && !avoid ? "#FFFFFF" : c.fg} size={18} />
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  text: { flex: 1, paddingVertical: 10 },
  check: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  stepper: { flexDirection: "row", gap: 8 },
  step: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
