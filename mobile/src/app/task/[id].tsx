import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { atLocalTime, durationMinutes, fromLocalDate, hhmm, scheduleDate, timed, toLocalDate } from "@core/domain/dates";
import { REPEAT_PRESETS, summarizeSchedule } from "@core/domain/recurrence";
import { BEFORE_PRESETS, DAY_PRESETS, reminderLabel } from "@core/domain/reminders";
import { derive, sortVMs } from "@core/domain/taskViews";
import { INBOX_ID, PRIORITY_LABEL, type Priority, type Reminder, type Schedule } from "@core/domain/types";
import { ensureTags, moveTasks, updateTask, useData } from "@core/stores/data";
import { deleteTasks, editTask, toggleDone } from "@core/stores/taskActions";
import { useColors } from "@/theme";
import { AddBox } from "@/ui/AddBox";
import { Button, Field, Label, Segmented } from "@/ui/kit";
import { pickDate } from "@/ui/pickDate";
import { TaskRow } from "@/ui/TaskRow";

const PRIORITIES = ([3, 2, 1, 0] as Priority[]).map((p) => ({ value: String(p), label: PRIORITY_LABEL[p] }));

/** Everything about one task. Text fields save when you leave them; the rest saves at once. */
export default function TaskScreen() {
  const c = useColors();
  const { id, key } = useLocalSearchParams<{ id: string; key?: string }>();
  const occurrence = key || null;
  const tasks = useData((s) => s.tasks);
  const lists = useData((s) => s.lists);
  const tagsById = useData((s) => s.tags);
  const t = tasks[id];
  const vm = useMemo(() => derive(tasks, lists).byId.get(id), [tasks, lists, id]);
  const kids = useMemo(() => (vm ? sortVMs(derive(tasks, lists).childrenOf(id), "manual") : []), [tasks, lists, id, vm]);

  const [title, setTitle] = useState(t?.title ?? "");
  const [notes, setNotes] = useState(t?.description ?? "");
  const tagText = (t?.tags ?? []).map((tid) => tagsById[tid]?.name).filter(Boolean).join(", ");
  const [tags, setTags] = useState(tagText);
  useEffect(() => setTags(tagText), [tagText]);

  if (!t || t.deletedAt) return <Text style={{ color: c.muted, padding: 16 }}>This task was deleted.</Text>;
  const schedule: Schedule = vm?.schedule ?? t.schedule;
  const done = t.status !== "open";

  const setSchedule = (s: Schedule) => void editTask(t.id, { schedule: s }, occurrence);
  const chooseDate = async () => {
    const date = scheduleDate(schedule);
    const picked = await pickDate("date", date ? fromLocalDate(date) : new Date());
    if (!picked) return;
    const day = toLocalDate(picked);
    setSchedule(schedule.kind === "timed" ? timed(atLocalTime(day, hhmm(new Date(schedule.start))), durationMinutes(schedule) ?? 60) : { kind: "day", date: day });
  };
  const chooseTime = async () => {
    const day = scheduleDate(schedule) ?? toLocalDate(new Date());
    const picked = await pickDate("time", schedule.kind === "timed" ? new Date(schedule.start) : atLocalTime(day, "09:00"));
    if (picked) setSchedule(timed(atLocalTime(day, hhmm(picked)), durationMinutes(schedule) ?? 60));
  };
  const saveTags = () => {
    const ids = ensureTags(tags.split(",").map((x) => x.trim().replace(/^#/, "")).filter(Boolean));
    if (ids.join() !== t.tags.join()) updateTask(t.id, { tags: ids });
  };

  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <TextInput
        value={title}
        onChangeText={setTitle}
        onEndEditing={() => title.trim() && title !== t.title && updateTask(t.id, { title: title.trim() })}
        multiline
        style={[s.title, { color: c.fg }]}
        accessibilityLabel="Title"
      />
      <Button label={done ? "Mark as not done" : "Complete"} icon={done ? "rotate-ccw" : "check"} kind={done ? "secondary" : "primary"} onPress={() => toggleDone(t.id, occurrence)} />

      <Label>When</Label>
      <Text style={{ color: c.fg, fontSize: 16, marginBottom: 8 }}>{summarizeSchedule(schedule, t.recurrence?.rule ?? null)}</Text>
      <View style={s.row}>
        <View style={s.flex}>
          <Button label="Date" icon="calendar" kind="secondary" onPress={chooseDate} />
        </View>
        <View style={s.flex}>
          <Button label="Time" icon="clock" kind="secondary" onPress={chooseTime} />
        </View>
        {schedule.kind !== "none" ? (
          <View style={s.flex}>
            <Button label="Clear" kind="secondary" onPress={() => setSchedule({ kind: "none" })} />
          </View>
        ) : null}
      </View>

      <Label>Repeat</Label>
      <Segmented
        value={REPEAT_PRESETS.some((p) => p.rule === t.recurrence?.rule) ? t.recurrence!.rule : t.recurrence ? "custom" : "none"}
        options={[{ value: "none", label: "Off" }, ...REPEAT_PRESETS.filter((p) => ["FREQ=DAILY", "FREQ=WEEKLY", "FREQ=MONTHLY"].includes(p.rule)).map((p) => ({ value: p.rule as string, label: p.label })), ...(t.recurrence && !REPEAT_PRESETS.some((p) => p.rule === t.recurrence?.rule) ? [{ value: "custom", label: "Custom" }] : [])]}
        onChange={(rule) => {
          if (rule === "custom") return;
          // A repeat needs a start date: today when the task has none.
          const anchored: Partial<typeof t> = schedule.kind === "none" ? { schedule: { kind: "day", date: toLocalDate(new Date()) } } : {};
          updateTask(t.id, { ...anchored, recurrence: rule === "none" ? null : { rule, exdates: [] } });
        }}
      />

      <Label>Remind me</Label>
      {schedule.kind === "none" ? (
        <Text style={{ color: c.muted, fontSize: 15 }}>Set a date to add a reminder.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
          {reminderChoices(schedule, t.reminders).map((r) => {
            const on = t.reminders.some((x) => sameReminder(x, r));
            return (
              <Text
                key={reminderLabel(r)}
                onPress={() => updateTask(t.id, { reminders: on ? t.reminders.filter((x) => !sameReminder(x, r)) : [...t.reminders, r] })}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                style={[s.chip, { backgroundColor: on ? c.accent : c.surface2, color: on ? c.accentFg : c.fg }]}
              >
                {reminderLabel(r)}
              </Text>
            );
          })}
        </ScrollView>
      )}

      <Label>Priority</Label>
      <Segmented value={String(t.priority)} options={PRIORITIES} onChange={(p) => updateTask(t.id, { priority: Number(p) as Priority })} />

      <Label>List</Label>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        {Object.values(lists)
          .filter((l) => !l.archived)
          .sort((a, b) => Number(b.id === INBOX_ID) - Number(a.id === INBOX_ID) || a.sortOrder - b.sortOrder)
          .map((l) => (
            <Text
              key={l.id}
              onPress={() => l.id !== t.listId && moveTasks([t.id], l.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: l.id === t.listId }}
              style={[s.chip, { backgroundColor: l.id === t.listId ? c.accent : c.surface2, color: l.id === t.listId ? c.accentFg : c.fg }]}
            >
              {l.name}
            </Text>
          ))}
      </ScrollView>

      <Label>Tags</Label>
      <Field value={tags} onChangeText={setTags} onEndEditing={saveTags} placeholder="errands, home" autoCapitalize="none" />

      <Label>Notes</Label>
      <Field value={notes} onChangeText={setNotes} onEndEditing={() => notes !== t.description && updateTask(t.id, { description: notes })} multiline placeholder="Add notes" style={{ minHeight: 120, paddingTop: 12, textAlignVertical: "top" }} />

      <Label>Subtasks</Label>
      <View style={{ marginHorizontal: -16 }}>
        {kids.map((k) => (
          <TaskRow key={k.task.id} vm={k} showList={false} />
        ))}
        <AddBox defaults={{ parentId: t.id, listId: t.listId }} placeholder="Add a subtask" />
      </View>

      <View style={{ height: 24 }} />
      <Button label="Delete task" icon="trash-2" kind="danger" onPress={async () => (await deleteTasks([t.id], occurrence)) && router.back()} />
    </ScrollView>
  );
}

const sameReminder = (a: Reminder, b: Reminder) => JSON.stringify(a) === JSON.stringify(b);
/** The presets that fit the schedule, plus any other reminder the task already has (set on the computer). */
function reminderChoices(schedule: Schedule, current: Reminder[]): Reminder[] {
  const presets: Reminder[] = schedule.kind === "timed" ? BEFORE_PRESETS.map((p) => ({ kind: "before", minutes: p.minutes })) : DAY_PRESETS.map((p) => ({ kind: "dayOf", daysBefore: p.daysBefore, time: p.time }));
  return [...presets, ...current.filter((r) => !presets.some((p) => sameReminder(p, r)))];
}

const s = StyleSheet.create({
  page: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: "600", marginBottom: 12 },
  row: { flexDirection: "row", gap: 8 },
  flex: { flex: 1 },
  chip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, overflow: "hidden" },
});
