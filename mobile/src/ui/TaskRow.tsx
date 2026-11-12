import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View } from "react-native";
import Swipeable, { SwipeDirection, type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { formatTime, relativeDayLabel, todayLocal } from "@core/domain/dates";
import type { TaskVM } from "@core/domain/taskViews";
import { INBOX_ID, PRIORITY_LABEL, PRIORITY_VAR } from "@core/domain/types";
import { useData } from "@core/stores/data";
import { useSettings } from "@core/stores/settings";
import { toggleDone } from "@core/stores/taskActions";
import { GUTTER, resolveColor, useColors } from "@/theme";
import { tick } from "./haptics";
import { Icon, Text } from "./kit";
import { reschedule } from "./reschedule";

export const openTaskDetails = (vm: Pick<TaskVM, "task" | "key">) => router.push({ pathname: "/task/[id]", params: { id: vm.task.id, key: vm.key ?? "" } });

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled().then((v) => (reduceMotion = v));
AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => (reduceMotion = v));

/** The ring fills at once; the row leaves for Done 600 ms later, so it can be seen and undone (04 §5). */
export function useComplete(vm: Pick<TaskVM, "task" | "key"> | null) {
  const [filling, setFilling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const done = !!vm && vm.task.status !== "open";
  return {
    checked: done || filling,
    toggle: () => {
      if (!vm) return;
      if (done) return toggleDone(vm.task.id, vm.key);
      if (filling) return;
      tick();
      if (reduceMotion) return toggleDone(vm.task.id, vm.key);
      setFilling(true);
      timer.current = setTimeout(() => (setFilling(false), toggleDone(vm.task.id, vm.key)), 600);
    },
  };
}

/** The task checkbox: a 22pt ring in the priority colour inside a 44pt target. */
export function Ring({ checked, color, onPress, label, size = 22 }: { checked: boolean; color: string; onPress: () => void; label: string; size?: number }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label} style={s.ringHit}>
      <View style={[{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, alignItems: "center", justifyContent: "center" }, { borderColor: checked ? c.muted : color, backgroundColor: checked ? c.muted : "transparent" }]}>
        {checked ? <Icon name="check" size={size * 0.6} color={c.surface} /> : null}
      </View>
    </Pressable>
  );
}

/**
 * A task as a calm two-line row: the ring completes it (with Undo), the row opens its sheet.
 * Swipe right to complete, left to reschedule (04 §7); both have visible alternatives.
 */
export function TaskRow({ vm, depth = 0, showList = true }: { vm: TaskVM; depth?: number; showList?: boolean }) {
  const c = useColors();
  const t = vm.task;
  const list = useData((s) => s.lists[t.listId]);
  const tags = useData((s) => s.tags);
  const timeFormat = useSettings((s) => s.settings.timeFormat);
  const swipe = useRef<SwipeableMethods>(null);
  const [width, setWidth] = useState(360);
  const { checked, toggle } = useComplete(vm);
  const done = t.status !== "open";
  const today = todayLocal();
  const time = vm.schedule.kind === "timed" ? formatTime(new Date(vm.schedule.start), timeFormat) : null;
  const when = vm.date === null ? null : vm.date === today ? time : `${relativeDayLabel(vm.date, today)}${time ? ` ${time}` : ""}`;
  const overdue = !done && vm.date !== null && vm.date < today;
  const ring = t.priority ? resolveColor(c, PRIORITY_VAR[t.priority]) : c.controlBorder;
  const checklist = t.checklist.length ? `${t.checklist.filter((i) => i.done).length}/${t.checklist.length}` : null;
  const listShown = showList && list && list.id !== INBOX_ID ? list : null;
  const meta = (
    <>
      {when ? <Text style={[s.meta, { color: overdue ? c.danger : c.muted }]}>{when}</Text> : null}
      {t.reminders.length && !done ? <Icon name="bell" size={13} color={c.muted} /> : null}
      {t.recurrence ? <Icon name="repeat" size={13} color={c.muted} /> : null}
      {checklist ? <Text style={[s.meta, { color: c.muted }]}>{checklist}</Text> : null}
      {t.tags.map((id) => (tags[id] ? <Text key={id} style={[s.meta, { color: c.muted }]}>{`#${tags[id].name}`}</Text> : null))}
      {listShown ? (
        <View style={s.listTag}>
          <View style={[s.dot, { backgroundColor: resolveColor(c, listShown.color, c.muted) }]} />
          <Text style={[s.meta, { color: c.muted }]}>{listShown.name}</Text>
        </View>
      ) : null}
    </>
  );
  const hasMeta = !!(when || t.reminders.length || t.recurrence || checklist || t.tags.length || listShown);
  const label = [t.title, when ? `due ${when}` : null, overdue ? "overdue" : null, t.priority ? `${PRIORITY_LABEL[t.priority]} priority` : null].filter(Boolean).join(", ");

  return (
    <Swipeable
      ref={swipe}
      friction={1.4}
      leftThreshold={width * 0.35}
      rightThreshold={width * 0.35}
      overshootFriction={8}
      renderLeftActions={() =>
        done ? null : (
          <View style={[s.action, { backgroundColor: c.successSoft, width }]}>
            <Icon name="check" color={c.success} />
            <Text style={{ fontWeight: "600", fontSize: 14 }}>Complete</Text>
          </View>
        )
      }
      renderRightActions={() => (
        <View style={[s.action, { backgroundColor: c.accentSoft, width, justifyContent: "flex-end" }]}>
          <Text style={{ fontWeight: "600", fontSize: 14 }}>Reschedule</Text>
          <Icon name="calendar" color={c.accentText} />
        </View>
      )}
      onSwipeableWillOpen={(dir) => {
        swipe.current?.close();
        if (dir === SwipeDirection.RIGHT) toggle();
        else void reschedule([{ source: "task", id: t.id, key: vm.key }]);
      }}
    >
      <Pressable
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onPress={() => openTaskDetails(vm)}
        accessibilityLabel={label}
        accessibilityHint="Opens the task"
        accessibilityActions={[{ name: "complete", label: done ? "Mark not done" : "Complete" }, { name: "reschedule", label: "Reschedule" }, { name: "activate", label: "Open" }]}
        onAccessibilityAction={(e) => (e.nativeEvent.actionName === "complete" ? toggle() : e.nativeEvent.actionName === "reschedule" ? void reschedule([{ source: "task", id: t.id, key: vm.key }]) : openTaskDetails(vm))}
        style={({ pressed }) => [s.row, { paddingLeft: GUTTER - 11 + depth * 28, backgroundColor: pressed ? c.surface2 : c.surface }]}
      >
        <Ring checked={checked} color={ring} onPress={toggle} label={`${done ? "Mark not done" : "Complete"} ${t.title}`} />
        <View style={[s.text, { borderColor: c.border }]}>
          <Text variant="bodyStrong" style={{ color: done ? c.muted : c.fg, textDecorationLine: done ? "line-through" : "none" }} numberOfLines={2}>
            {t.title || "Untitled"}
          </Text>
          {hasMeta ? <View style={s.metaRow}>{meta}</View> : null}
        </View>
      </Pressable>
    </Swipeable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", paddingRight: GUTTER, minHeight: 52 },
  ringHit: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginTop: 1 },
  text: { flex: 1, paddingTop: 12, paddingBottom: 12, marginLeft: 3, borderBottomWidth: StyleSheet.hairlineWidth },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 2, marginTop: 3 },
  meta: { fontSize: 13, lineHeight: 18, fontVariant: ["tabular-nums"] },
  listTag: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  action: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: GUTTER },
});
