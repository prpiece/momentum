import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { droppedSchedule } from "@core/domain/calendar";
import { addDaysLocal, atLocalTime, durationMinutes, formatMinutes, formatTime, hhmm, relativeDayLabel, scheduleDate, timed, todayLocal } from "@core/domain/dates";
import { WAIT_DEFAULT_DAYS } from "@core/domain/quickAdd";
import { waitLoops } from "@core/domain/waiting";
import { describeRule, REPEAT_PRESETS } from "@core/domain/recurrence";
import { BEFORE_PRESETS, DAY_PRESETS, reminderLabel } from "@core/domain/reminders";
import { derive, sortVMs } from "@core/domain/taskViews";
import { INBOX_ID, PRIORITY_LABEL, PRIORITY_VAR, type Priority, type Reminder, type Schedule } from "@core/domain/types";
import { addTask, ensureTags, moveTasks, updateTask, useData } from "@core/stores/data";
import { startFocus } from "@core/stores/focus";
import { useSettings } from "@core/stores/settings";
import { deleteTasks, editTask, toggleDone } from "@core/stores/taskActions";
import { FONTS, GUTTER, resolveColor, useColors } from "@/theme";
import { Button, Card, FieldRow, Icon, Text } from "@/ui/kit";
import { pickDate } from "@/ui/pickDate";
import { askAlarmPermission } from "@/notify";
import { askDay } from "@/ui/reschedule";
import { askText, choose } from "@/ui/Sheet";
import { Ring, useComplete } from "@/ui/TaskRow";
import { sendToFriend } from "@/social/actions";
import { canEdit, useRole } from "@/social/roles";

/**
 * A task's sheet (S4): title and notes, then the fields people change most, with repeat and
 * time behind "More". Text saves when you leave the field; everything else at once.
 */
export default function TaskSheet() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { id, key } = useLocalSearchParams<{ id: string; key?: string }>();
  const occurrence = key || null;
  const tasks = useData((s) => s.tasks);
  const lists = useData((s) => s.lists);
  const tagsById = useData((s) => s.tags);
  const timeFormat = useSettings((s) => s.settings.timeFormat);
  const t = tasks[id];
  const d = useMemo(() => derive(tasks, lists), [tasks, lists]);
  const vm = d.byId.get(id);
  const kids = useMemo(() => (vm ? sortVMs(d.childrenOf(id), "manual") : []), [d, id, vm]);
  const [title, setTitle] = useState(t?.title ?? "");
  // Attachments don't sync (D229): hide their markdown, keep it when the notes are saved.
  const attachments = (t?.description ?? "").match(ATTACHMENT) ?? [];
  const [notes, setNotes] = useState((t?.description ?? "").replace(ATTACHMENT, "").trim());
  const [more, setMore] = useState(false);
  const [sub, setSub] = useState("");
  useEffect(() => setTitle(t?.title ?? ""), [t?.title]);
  const { viewer } = useRole(t?.listId);
  const complete = useComplete(t ? { task: t, key: occurrence ?? vm?.key ?? null } : null);

  if (!t || t.deletedAt)
    return (
      <View style={[s.page, { padding: GUTTER, gap: 16 }]}>
        <Text variant="heading">This task was deleted</Text>
        <Text variant="secondary" style={{ color: c.fg2 }}>
          It was deleted on this phone or another device, so there's nothing to open.
        </Text>
        <Button label="Close" kind="secondary" onPress={() => router.back()} />
      </View>
    );

  const schedule: Schedule = vm?.schedule ?? t.schedule;
  const done = t.status !== "open";
  const date = scheduleDate(schedule);
  const today = todayLocal();
  const list = lists[t.listId];
  const setSchedule = (next: Schedule) => void editTask(t.id, { schedule: next }, occurrence);
  const rule = t.recurrence?.rule ?? null;

  const chooseDay = async () => {
    const day = await askDay(date, { someday: true, title: "Planned" });
    if (day === undefined) return;
    setSchedule(day === "someday" ? { kind: "someday" } : day ? droppedSchedule(schedule, day, "keepTime", 0) : { kind: "none" });
  };
  // Planning fields (D267), the same ones desktop edits.
  const chooseDeadline = async () => {
    const day = await askDay(t.deadline, { someday: true, title: "Deadline" });
    if (day !== undefined && day !== "someday") updateTask(t.id, { deadline: day });
  };
  const timedMin = durationMinutes(schedule);
  const chooseDuration = async () => {
    if (timedMin !== null) return void (await chooseTime());
    const m = await choose<number>("Duration", [
      ...[5, 10, 15, 30, 45, 60, 90, 120].map((v) => ({ value: v, label: formatMinutes(v), icon: "clock" as const, selected: t.durationMin === v })),
      ...(t.durationMin ? [{ value: 0, label: "No duration", icon: "slash" as const }] : []),
    ]);
    if (m !== null) updateTask(t.id, { durationMin: m || null });
  };
  const chooseWaiting = async () => {
    const k = await choose<"person" | "task" | "none">("Waiting for", [
      { value: "person", label: "A person…", icon: "user" },
      { value: "task", label: "Another task…", icon: "check-circle" },
      ...(t.waiting ? [{ value: "none" as const, label: "Not waiting", icon: "slash" as const }] : []),
    ]);
    if (k === null) return;
    if (k === "none") return updateTask(t.id, { waiting: null });
    if (k === "person") {
      const who = await askText("Waiting for", { value: t.waiting?.kind === "person" ? t.waiting.who : "", placeholder: "Sam", confirm: "Next" });
      if (!who?.trim()) return;
      const followUp = await askDay(t.waiting?.kind === "person" ? t.waiting.followUp : addDaysLocal(today, WAIT_DEFAULT_DAYS));
      if (followUp) updateTask(t.id, { waiting: { kind: "person", who: who.trim(), followUp } });
      return;
    }
    const other = await choose<string>(
      "Waiting on",
      d.active
        .filter((v) => v.task.id !== t.id && v.task.status === "open" && !waitLoops(t.id, { kind: "task", taskId: v.task.id }, tasks))
        .slice(0, 30)
        .map((v) => ({ value: v.task.id, label: v.task.title, selected: t.waiting?.kind === "task" && t.waiting.taskId === v.task.id })),
    );
    if (other) updateTask(t.id, { waiting: { kind: "task", taskId: other } });
  };
  const chooseTime = async () => {
    const day = date ?? today;
    const choice = schedule.kind === "timed" ? await choose("Time", [{ value: "change", label: "Change time", icon: "clock" }, { value: "none", label: "No time", icon: "slash" }]) : "change";
    if (choice === "none") return setSchedule({ kind: "day", date: day });
    if (choice !== "change") return;
    const picked = await pickDate("time", schedule.kind === "timed" ? new Date(schedule.start) : atLocalTime(day, "09:00"));
    if (picked) setSchedule(timed(atLocalTime(day, hhmm(picked)), durationMinutes(schedule) ?? 60));
  };
  const chooseReminder = async () => {
    if (schedule.kind === "none") return void (await chooseDay());
    const r = await choose<Reminder | "none">("Remind me", [
      ...reminderChoices(schedule, t.reminders).map((r) => ({ value: r, label: reminderLabel(r), icon: "bell" as const, selected: t.reminders.some((x) => same(x, r)) })),
      ...(t.reminders.length ? [{ value: "none" as const, label: "No reminders", icon: "bell-off" as const }] : []),
    ]);
    if (r === null) return;
    if (r === "none") return updateTask(t.id, { reminders: [] });
    const on = t.reminders.some((x) => same(x, r));
    updateTask(t.id, { reminders: on ? t.reminders.filter((x) => !same(x, r)) : [...t.reminders, r] });
    if (!on && t.priority === 3) void askAlarmPermission();
  };
  const choosePriority = async () => {
    const p = await choose<Priority>("Priority", ([3, 2, 1, 0] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p], icon: "flag", color: p ? resolveColor(c, PRIORITY_VAR[p]) : c.muted, selected: t.priority === p })));
    if (p === null) return;
    updateTask(t.id, { priority: p });
    if (p === 3 && t.reminders.length) void askAlarmPermission();
  };
  const chooseList = async () => {
    const options = Object.values(lists)
      .filter((l) => !l.archived && canEdit(l.id))
      .sort((a, b) => Number(b.id === INBOX_ID) - Number(a.id === INBOX_ID) || a.sortOrder - b.sortOrder)
      .map((l) => ({ value: l.id, label: l.name, icon: l.id === INBOX_ID ? ("inbox" as const) : undefined, color: l.id === INBOX_ID ? undefined : resolveColor(c, l.color, c.muted), selected: l.id === t.listId }));
    const to = await choose("List", options);
    if (to && to !== t.listId) moveTasks([t.id], to);
  };
  const chooseTag = async () => {
    const tid = await choose<string>("Tags", [
      ...Object.values(tagsById)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((g) => ({ value: g.id, label: `#${g.name}`, selected: t.tags.includes(g.id) })),
      { value: "", label: "New tag…", icon: "plus" },
    ]);
    if (tid === null) return;
    if (tid) return updateTask(t.id, { tags: t.tags.includes(tid) ? t.tags.filter((x) => x !== tid) : [...t.tags, tid] });
    const name = await askText("New tag", { placeholder: "errands", confirm: "Add" });
    if (name) updateTask(t.id, { tags: [...new Set([...t.tags, ...ensureTags([name.replace(/^#/, "")])])] });
  };
  const chooseRepeat = async () => {
    const r = await choose<string>("Repeat", [{ value: "", label: "Doesn't repeat", selected: !rule }, ...REPEAT_PRESETS.map((p) => ({ value: p.rule, label: p.label, selected: p.rule === rule })), ...(rule && !REPEAT_PRESETS.some((p) => p.rule === rule) ? [{ value: rule, label: describeRule(rule), selected: true }] : [])]);
    if (r === null || r === (rule ?? "")) return;
    // A repeat needs a start date: today when the task has none; a Someday task has to pick one, or the repeat would be dropped.
    let anchored = schedule.kind === "none" ? { schedule: { kind: "day", date: today } as Schedule } : {};
    if (r && schedule.kind === "someday") {
      const day = await askDay(today);
      if (!day) return;
      anchored = { schedule: { kind: "day", date: day } as Schedule };
    }
    updateTask(t.id, { ...anchored, recurrence: r ? { rule: r, exdates: [] } : null });
  };
  const addSub = () => {
    if (!sub.trim()) return;
    addTask({ title: sub.trim(), parentId: t.id, listId: t.listId }, "bottom");
    setSub("");
  };

  const planned = schedule.kind === "someday" ? "Someday" : date ? `${relativeDayLabel(date, today)}${schedule.kind === "timed" ? ` ${formatTime(new Date(schedule.start), timeFormat)}` : ""}` : "";
  const minutes = timedMin ?? t.durationMin;
  const waitingLabel = t.waiting?.kind === "person" ? `${t.waiting.who} · ${relativeDayLabel(t.waiting.followUp, today)}` : t.waiting?.kind === "task" ? (tasks[t.waiting.taskId]?.title ?? "A deleted task") : "";
  const tagNames = t.tags.map((x) => tagsById[x] && `#${tagsById[x].name}`).filter(Boolean).join(" ");
  const kidsDone = kids.filter((k) => k.task.status !== "open").length;

  return (
    <View style={s.page}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={s.head}>
          <Ring checked={complete.checked} color={t.priority ? resolveColor(c, PRIORITY_VAR[t.priority]) : c.controlBorder} onPress={viewer ? () => undefined : complete.toggle} label={`${done ? "Mark not done" : "Complete"} ${t.title}`} size={24} />
          <View style={{ flex: 1, paddingTop: 6 }}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              onEndEditing={() => title.trim() && title !== t.title && updateTask(t.id, { title: title.trim() })}
              multiline
              editable={!viewer}
              maxFontSizeMultiplier={2}
              style={[s.title, { color: done ? c.muted : c.fg }]}
              accessibilityLabel="Title"
            />
            <TextInput
              value={notes}
              onChangeText={setNotes}
              onEndEditing={() => {
                const next = [notes.trim(), ...attachments].filter(Boolean).join("\n\n");
                if (next !== t.description) updateTask(t.id, { description: next });
              }}
              multiline
              editable={!viewer}
              placeholder="Add notes"
              placeholderTextColor={c.muted}
              maxFontSizeMultiplier={2}
              style={[s.notes, { color: c.fg2 }]}
              accessibilityLabel="Notes"
            />
            {attachments.length ? (
              <View style={s.image}>
                <Icon name="image" size={16} color={c.muted} />
                <Text variant="meta" style={{ color: c.muted }}>
                  {attachments.length > 1 ? `${attachments.length} images on desktop` : "Image on desktop"}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {viewer ? (
          <Text variant="meta" style={{ color: c.muted, paddingHorizontal: GUTTER, paddingTop: 12 }}>
            You can view this task. Only editors and the owner change it.
          </Text>
        ) : null}
        <Card style={[{ marginTop: 16 }, viewer && { opacity: 0.6, pointerEvents: "none" }]}>
          <FieldRow first icon="calendar" title="Planned" value={planned || "No date"} valueColor={date && date < today && !done ? c.danger : undefined} onPress={chooseDay} />
          <FieldRow icon="check-square" title="Deadline" value={t.deadline ? `by ${relativeDayLabel(t.deadline, today)}` : "None"} valueColor={t.deadline && t.deadline < today && !done ? c.danger : undefined} onPress={chooseDeadline} />
          <FieldRow icon="clock" title="Duration" value={minutes ? formatMinutes(minutes) : "None"} onPress={chooseDuration} />
          <FieldRow icon="pause-circle" title="Waiting for" value={waitingLabel || "Nothing"} onPress={chooseWaiting} />
          <FieldRow icon="bell" title="Reminder" value={t.reminders.map(reminderLabel).join(", ") || (date ? "None" : "Set a date first")} onPress={chooseReminder} />
          <FieldRow icon="flag" title="Priority" value={PRIORITY_LABEL[t.priority]} valueColor={t.priority ? resolveColor(c, PRIORITY_VAR[t.priority]) : undefined} onPress={choosePriority} />
          <FieldRow icon="list" title="List" value={list?.name ?? "Inbox"} onPress={chooseList} />
          <FieldRow icon="tag" title="Tags" value={tagNames || "None"} onPress={chooseTag} />
          {more ? (
            <>
              <FieldRow icon="clock" title="Time" value={schedule.kind === "timed" ? formatTime(new Date(schedule.start), timeFormat) : "No time"} onPress={chooseTime} />
              <FieldRow icon="repeat" title="Repeat" value={rule ? (REPEAT_PRESETS.find((p) => p.rule === rule)?.label ?? describeRule(rule)) : "Doesn't repeat"} onPress={chooseRepeat} />
            </>
          ) : null}
        </Card>
        {more ? null : (
          <Pressable onPress={() => setMore(true)} accessibilityRole="button" style={s.more}>
            <Icon name="chevron-down" size={16} color={c.muted} />
            <Text style={{ color: c.muted, fontSize: 14 }}>More: time, repeat</Text>
          </Pressable>
        )}

        <View style={s.subHead}>
          <Text style={{ flex: 1, fontSize: 15, fontWeight: "600" }}>Subtasks</Text>
          {kids.length ? <Text style={{ color: c.muted, fontSize: 13, fontVariant: ["tabular-nums"] }}>{`${kidsDone} of ${kids.length}`}</Text> : null}
        </View>
        {kids.map((k) => (
          <Pressable key={k.task.id} onPress={() => router.push({ pathname: "/task/[id]", params: { id: k.task.id, key: k.key ?? "" } })} style={s.subRow}>
            <Ring checked={k.task.status !== "open"} color={c.controlBorder} size={20} onPress={viewer ? () => undefined : () => toggleDone(k.task.id, k.key)} label={`Complete ${k.task.title}`} />
            <Text variant="secondary" style={{ flex: 1, color: k.task.status !== "open" ? c.muted : c.fg, textDecorationLine: k.task.status !== "open" ? "line-through" : "none" }}>
              {k.task.title}
            </Text>
          </Pressable>
        ))}
        {viewer ? null : <View style={s.subRow}>
          <View style={{ width: 44, alignItems: "center" }}>
            <Icon name="plus" color={c.muted} />
          </View>
          <TextInput value={sub} onChangeText={setSub} onSubmitEditing={addSub} submitBehavior="submit" returnKeyType="done" placeholder="Add subtask" placeholderTextColor={c.muted} maxFontSizeMultiplier={2} style={[s.subInput, { color: c.fg }]} />
        </View>}
        <Card style={{ marginTop: 12 }}>
          <FieldRow first icon="send" title="Send to friend" onPress={() => void sendToFriend(t, kids.map((k) => k.task.title))} />
        </Card>
        <View style={[s.footer, { borderColor: c.border, paddingBottom: insets.bottom + 16 }]}>
        {viewer ? null : <Button label="Delete" icon="trash-2" kind="outline" onPress={async () => (await deleteTasks([t.id], occurrence)) && router.back()} style={{ paddingHorizontal: 14 }} />}
        <Button
          label="Start focus"
          icon="clock"
          style={{ flex: 1 }}
          onPress={() => {
            startFocus("pomodoro", t.id);
            router.replace("/focus");
          }}
        />
        </View>
      </ScrollView>
    </View>
  );
}

const ATTACHMENT = /!\[[^\]]*\]\(attachment:[^)]+\)/g;
const same = (a: Reminder, b: Reminder) => JSON.stringify(a) === JSON.stringify(b);
/** The presets that fit the schedule, plus any other reminder the task already has (set on the computer). */
function reminderChoices(schedule: Schedule, current: Reminder[]): Reminder[] {
  const presets: Reminder[] = schedule.kind === "timed" ? BEFORE_PRESETS.map((p) => ({ kind: "before", minutes: p.minutes })) : DAY_PRESETS.map((p) => ({ kind: "dayOf", daysBefore: p.daysBefore, time: p.time }));
  return [...presets, ...current.filter((r) => !presets.some((p) => same(p, r)))];
}


const s = StyleSheet.create({
  page: { flex: 1 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 4, paddingLeft: GUTTER - 11, paddingRight: GUTTER, paddingTop: 16 },
  title: { fontFamily: FONTS[600], fontSize: 20, lineHeight: 28, padding: 0 },
  notes: { fontFamily: FONTS[400], fontSize: 15, lineHeight: 22, padding: 0, marginTop: 6 },
  more: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: GUTTER },
  subHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: GUTTER, paddingTop: 12, paddingBottom: 4 },
  subRow: { flexDirection: "row", alignItems: "center", minHeight: 44, paddingLeft: GUTTER - 12, paddingRight: GUTTER, gap: 4 },
  subInput: { flex: 1, fontFamily: FONTS[400], fontSize: 15, padding: 0, minHeight: 44 },
  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 12, marginTop: 16, borderTopWidth: StyleSheet.hairlineWidth },
  image: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
});
