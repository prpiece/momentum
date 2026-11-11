import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { todayLocal } from "@core/domain/dates";
import { elapsedMs, remainingMs, type FocusMode } from "@core/domain/focus";
import { derive, inSmartList } from "@core/domain/taskViews";
import { useData } from "@core/stores/data";
import { pauseFocus, resumeFocus, skipPhase, startFocus, stopFocus, tickFocus, useFocus } from "@core/stores/focus";
import { useSettings } from "@core/stores/settings";
import { useColors } from "@/theme";
import { Button, Label, Segmented } from "@/ui/kit";

const clock = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(t / 3600);
  const mm = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
  const ss = String(t % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
const PHASE = { focus: "Focus", short: "Short break", long: "Long break" } as const;

/** Pomodoro or stopwatch, optionally on one of today's tasks. Time comes from timestamps, so it's right after the phone sleeps. */
export default function Focus() {
  const c = useColors();
  const timer = useFocus((s) => s.timer);
  const cfg = useSettings((s) => s.settings.pomodoro);
  const tasks = useData((s) => s.tasks);
  const lists = useData((s) => s.lists);
  const [mode, setMode] = useState<FocusMode>("pomodoro");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => {
      tickFocus(); // ends a pomodoro phase on time and moves to the next
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(i);
  }, []);
  const choices = useMemo(() => {
    const today = todayLocal();
    return derive(tasks, lists).roots.filter((vm) => vm.task.status === "open" && (inSmartList("today", vm, today) || inSmartList("inbox", vm, today))).slice(0, 12);
  }, [tasks, lists]);

  const active = timer.status === "running" || timer.status === "paused";
  const shown = active ? (timer.mode === "pomodoro" ? (remainingMs(timer, now, cfg) ?? 0) : elapsedMs(timer, now)) : mode === "pomodoro" ? cfg.focusMin * 60_000 : 0;
  const onTask = active && timer.taskId ? tasks[timer.taskId]?.title : null;

  return (
    <ScrollView contentContainerStyle={s.page}>
      {!active ? <Segmented value={mode} options={[{ value: "pomodoro", label: "Timer" }, { value: "stopwatch", label: "Stopwatch" }]} onChange={setMode} /> : null}
      <Text style={[s.phase, { color: c.fg2 }]}>{active ? (timer.mode === "pomodoro" ? `${PHASE[timer.phase]} · round ${timer.round}` : "Stopwatch") : timer.status === "done" ? "Session complete" : "Ready"}</Text>
      <Text style={[s.clock, { color: c.fg }]} accessibilityRole="timer">
        {clock(shown)}
      </Text>
      {onTask ? <Text style={{ color: c.fg2, textAlign: "center", fontSize: 16, marginBottom: 16 }}>On: {onTask}</Text> : null}
      <View style={s.buttons}>
        {!active ? (
          <Button label="Start" icon="play" onPress={() => startFocus(mode, taskId)} />
        ) : (
          <>
            {timer.status === "running" ? <Button label="Pause" icon="pause" kind="secondary" onPress={pauseFocus} /> : <Button label="Resume" icon="play" onPress={resumeFocus} />}
            {timer.mode === "pomodoro" ? <Button label="Skip" icon="skip-forward" kind="secondary" onPress={skipPhase} /> : null}
            <Button label="Stop" icon="square" kind="secondary" onPress={stopFocus} />
          </>
        )}
      </View>
      {!active ? (
        <>
          <Label>Focus on</Label>
          {[{ id: null, title: "No task" }, ...choices.map((vm) => ({ id: vm.task.id, title: vm.task.title }))].map((o) => (
            <Pressable key={o.id ?? "none"} onPress={() => setTaskId(o.id)} accessibilityRole="radio" accessibilityState={{ selected: taskId === o.id }} style={[s.choice, { borderColor: c.border, backgroundColor: taskId === o.id ? c.accentSoft : "transparent" }]}>
              <Text style={{ color: c.fg, fontSize: 16 }} numberOfLines={1}>
                {o.title}
              </Text>
            </Pressable>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, paddingBottom: 48 },
  phase: { textAlign: "center", fontSize: 16, marginTop: 24 },
  clock: { textAlign: "center", fontSize: 72, fontWeight: "300", fontVariant: ["tabular-nums"], marginVertical: 8 },
  buttons: { gap: 10 },
  choice: { minHeight: 52, justifyContent: "center", paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});
