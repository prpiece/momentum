import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Switch, View } from "react-native";
import { hhmmOf } from "@core/domain/calendar";
import { atLocalTime, durationMinutes, fromLocalDate, hhmm, scheduleDate, timed, toLocalDate } from "@core/domain/dates";
import { scheduleForKey, summarizeSchedule } from "@core/domain/recurrence";
import type { LocalDate, Schedule } from "@core/domain/types";
import { addEvent, updateEvent, useData } from "@core/stores/data";
import { createFromText } from "@core/stores/quickAddSubmit";
import { applySchedule, deleteEvent } from "@core/stores/schedule";
import { useColors } from "@/theme";
import { Button, Field, Label, Segmented, Text } from "@/ui/kit";
import { pickDate } from "@/ui/pickDate";

/** `new` (from a calendar tap: a task or an event at that slot) or one event to edit. */
export default function EventScreen() {
  const { id, key, day, minute } = useLocalSearchParams<{ id: string; key?: string; day?: string; minute?: string }>();
  return id === "new" ? <NewItem day={day ?? toLocalDate(new Date())} minute={minute ? Number(minute) : null} /> : <EditEvent id={id} occurrence={key || null} />;
}

function NewItem({ day, minute }: { day: LocalDate; minute: number | null }) {
  const [kind, setKind] = useState<"task" | "event">("event");
  const [title, setTitle] = useState("");
  const schedule: Schedule = minute === null ? { kind: "day", date: day } : timed(atLocalTime(day, hhmmOf(minute)), 60);
  const save = () => {
    if (!title.trim()) return;
    if (kind === "task") createFromText(title, { schedule }, true, () => false);
    else addEvent({ title: title.trim(), schedule });
    router.back();
  };
  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: summarizeSchedule(schedule, null) }} />
      <Segmented value={kind} options={[{ value: "event", label: "Event" }, { value: "task", label: "Task" }]} onChange={setKind} />
      <View style={{ height: 12 }} />
      <Field value={title} onChangeText={setTitle} onSubmitEditing={save} autoFocus placeholder={kind === "task" ? "Task (tokens like !high #tag work)" : "Event title"} returnKeyType="done" />
      <View style={{ height: 12 }} />
      <Button label={`Add ${kind}`} onPress={save} disabled={!title.trim()} />
    </ScrollView>
  );
}

function EditEvent({ id, occurrence }: { id: string; occurrence: string | null }) {
  const c = useColors();
  const e = useData((s) => s.events[id]);
  const [title, setTitle] = useState(e?.title ?? "");
  const [notes, setNotes] = useState(e?.notes ?? "");
  if (!e || e.deletedAt) return <Text style={{ color: c.muted, padding: 16 }}>This event was deleted.</Text>;
  const readOnly = e.source === "ics";
  const ref = { source: "event" as const, id, key: occurrence };
  const schedule = occurrence && e.recurrence ? scheduleForKey(e.schedule, occurrence) : e.schedule;
  const date = scheduleDate(schedule) ?? toLocalDate(new Date());

  const chooseDate = async () => {
    const picked = await pickDate("date", fromLocalDate(date));
    if (!picked) return;
    const d = toLocalDate(picked);
    void applySchedule(ref, schedule.kind === "timed" ? timed(atLocalTime(d, hhmm(new Date(schedule.start))), durationMinutes(schedule) ?? 60) : { kind: "day", date: d });
  };
  const chooseTime = async (edge: "start" | "end") => {
    if (schedule.kind !== "timed") return;
    const picked = await pickDate("time", new Date(edge === "start" ? schedule.start : schedule.end));
    if (!picked) return;
    if (edge === "start") void applySchedule(ref, timed(atLocalTime(date, hhmm(picked)), durationMinutes(schedule) ?? 60));
    else {
      const end = atLocalTime(date, hhmm(picked));
      if (end > new Date(schedule.start)) void applySchedule(ref, { kind: "timed", start: schedule.start, end: end.toISOString() });
    }
  };

  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Field value={title} editable={!readOnly} onChangeText={setTitle} onEndEditing={() => title.trim() && title !== e.title && updateEvent(id, { title: title.trim() })} style={{ fontSize: 20, fontWeight: "600" }} />
      {readOnly ? <Text style={{ color: c.muted, marginTop: 8 }}>Imported events are read-only.</Text> : null}
      <Label>When</Label>
      <Text style={{ color: c.fg, fontSize: 16, marginBottom: 8 }}>{summarizeSchedule(schedule, e.recurrence?.rule ?? null).replace(/\d\d:\d\d/, (t) => (schedule.kind === "timed" ? `${t} – ${hhmm(new Date(schedule.end))}` : t))}</Text>
      {!readOnly ? (
        <>
          <View style={s.row}>
            <View style={s.flex}>
              <Button label="Date" icon="calendar" kind="secondary" onPress={chooseDate} />
            </View>
            {schedule.kind === "timed" ? (
              <>
                <View style={s.flex}>
                  <Button label="Start" icon="clock" kind="secondary" onPress={() => chooseTime("start")} />
                </View>
                <View style={s.flex}>
                  <Button label="End" kind="secondary" onPress={() => chooseTime("end")} />
                </View>
              </>
            ) : null}
          </View>
          <View style={[s.row, { alignItems: "center", marginTop: 12 }]}>
            <Text style={{ color: c.fg, fontSize: 16, flex: 1 }}>All day</Text>
            <Switch
              value={schedule.kind === "day"}
              onValueChange={(allDay) => void applySchedule(ref, allDay ? { kind: "day", date } : timed(atLocalTime(date, "09:00"), 60))}
              accessibilityLabel="All day"
            />
          </View>
          <Label>Notes</Label>
          <Field value={notes} onChangeText={setNotes} onEndEditing={() => notes !== e.notes && updateEvent(id, { notes })} multiline placeholder="Add notes" style={{ minHeight: 100, paddingTop: 12, textAlignVertical: "top" }} />
          <View style={{ height: 24 }} />
          <Button label="Delete event" icon="trash-2" kind="danger" onPress={async () => (await deleteEvent(id, occurrence)) && router.back()} />
        </>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, paddingBottom: 48 },
  row: { flexDirection: "row", gap: 8 },
  flex: { flex: 1 },
});
