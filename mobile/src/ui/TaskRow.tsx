import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatTime, relativeDayLabel, todayLocal } from "@core/domain/dates";
import type { TaskVM } from "@core/domain/taskViews";
import { PRIORITY_VAR } from "@core/domain/types";
import { useData } from "@core/stores/data";
import { useSettings } from "@core/stores/settings";
import { toggleDone } from "@core/stores/taskActions";
import { resolveColor, useColors } from "@/theme";

export const openTaskDetails = (vm: TaskVM) => router.push({ pathname: "/task/[id]", params: { id: vm.task.id, key: vm.key ?? "" } });

/** A task as a two-line row (D200): the checkbox completes it (with Undo), the row opens its details. */
export function TaskRow({ vm, depth = 0, showList = true }: { vm: TaskVM; depth?: number; showList?: boolean }) {
  const c = useColors();
  const t = vm.task;
  const list = useData((s) => s.lists[t.listId]);
  const tags = useData((s) => s.tags);
  const timeFormat = useSettings((s) => s.settings.timeFormat);
  const done = t.status !== "open";
  const today = todayLocal();
  const time = vm.schedule.kind === "timed" ? formatTime(new Date(vm.schedule.start), timeFormat) : null;
  const when = vm.date === null ? null : vm.date === today ? (time ?? "Today") : `${relativeDayLabel(vm.date, today)}${time ? ` ${time}` : ""}`;
  const overdue = !done && vm.date !== null && vm.date < today;
  const ring = t.priority ? resolveColor(c, PRIORITY_VAR[t.priority]) : c.muted;
  const meta = [when, ...t.tags.map((id) => tags[id] && `#${tags[id].name}`), showList && list && list.id !== "inbox" ? list.name : null, t.recurrence ? "↻" : null].filter(Boolean);

  return (
    <Pressable onPress={() => openTaskDetails(vm)} style={({ pressed }) => [s.row, { borderColor: c.border, paddingLeft: 16 + depth * 28, backgroundColor: pressed ? c.surface2 : "transparent" }]}>
      <Pressable
        onPress={() => toggleDone(t.id, vm.key)}
        hitSlop={12}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={`Complete ${t.title}`}
        style={[s.check, { borderColor: done ? c.accent : ring, backgroundColor: done ? c.accent : "transparent" }]}
      />
      <View style={s.text}>
        <Text style={[s.title, { color: done ? c.muted : c.fg, textDecorationLine: done ? "line-through" : "none" }]} numberOfLines={2}>
          {t.title || "Untitled"}
        </Text>
        {meta.length ? (
          <Text style={[s.meta, { color: overdue ? c.danger : c.muted }]} numberOfLines={1}>
            {meta.join("  ·  ")}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 56, paddingRight: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
  text: { flex: 1 },
  title: { fontSize: 16 },
  meta: { fontSize: 13, marginTop: 3 },
});
