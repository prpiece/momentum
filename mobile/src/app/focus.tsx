import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatTime, toLocalDate, todayLocal } from "@core/domain/dates";
import { elapsedMs, remainingMs, type FocusMode } from "@core/domain/focus";
import { derive, inSmartList } from "@core/domain/taskViews";
import { useData } from "@core/stores/data";
import { pauseFocus, resumeFocus, skipPhase, startFocus, stopFocus, tickFocus, useFocus } from "@core/stores/focus";
import { useSettings } from "@core/stores/settings";
import { GUTTER, useColors } from "@/theme";
import { clock } from "@/ui/FocusBar";
import { Button, Icon, Segmented, Text } from "@/ui/kit";
import { choose } from "@/ui/Sheet";

const PHASE = { focus: "Focus", short: "Short break", long: "Long break" } as const;

/** Focus (S8): a timer or stopwatch, optionally on a task. Time comes from timestamps, so it's right after the phone sleeps. */
export default function Focus() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const timer = useFocus((s) => s.timer);
  const sessions = useFocus((s) => s.sessions);
  const cfg = useSettings((s) => s.settings.pomodoro);
  const timeFormat = useSettings((s) => s.settings.timeFormat);
  const tasks = useData((s) => s.tasks);
  const lists = useData((s) => s.lists);
  const [mode, setMode] = useState<FocusMode>("pomodoro");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => (tickFocus(), setNow(Date.now())), 1000);
    return () => clearInterval(i);
  }, []);
  const choices = useMemo(() => {
    const today = todayLocal();
    return derive(tasks, lists).roots.filter((vm) => vm.task.status === "open" && (inSmartList("today", vm, today) || inSmartList("inbox", vm, today))).slice(0, 20);
  }, [tasks, lists]);
  const focusedToday = useMemo(() => {
    const today = todayLocal();
    const sec = Object.values(sessions).filter((x) => toLocalDate(new Date(x.startAt)) === today).reduce((a, x) => a + x.seconds, 0);
    return sec >= 60 ? `${sec >= 3600 ? `${Math.floor(sec / 3600)}h ` : ""}${Math.floor((sec % 3600) / 60)}m focused today` : null;
  }, [sessions]);

  const active = timer.status === "running" || timer.status === "paused";
  const left = active && timer.mode === "pomodoro" ? (remainingMs(timer, now, cfg) ?? 0) : null;
  const shown = active ? (left ?? elapsedMs(timer, now)) : mode === "pomodoro" ? cfg.focusMin * 60_000 : 0;
  const onId = active ? timer.taskId : taskId;
  const onTask = onId ? tasks[onId] : undefined;
  const status = active
    ? timer.mode === "pomodoro"
      ? `${PHASE[timer.phase]} · round ${timer.round}${timer.status === "running" && left !== null ? ` · ends ${formatTime(new Date(now + left), timeFormat)}` : ""}`
      : "Stopwatch"
    : timer.status === "done"
      ? "Session complete"
      : "Ready";

  const pickTask = async () => {
    const id = await choose<string>("Focus on", [{ value: "", label: "No task", icon: "slash", selected: !taskId }, ...choices.map((vm) => ({ value: vm.task.id, label: vm.task.title, selected: vm.task.id === taskId }))]);
    if (id !== null) setTaskId(id || null);
  };
  const stop = () => {
    const min = Math.floor((active ? (timer.mode === "pomodoro" && timer.phase === "focus" ? elapsedMs(timer, now) : timer.mode === "stopwatch" ? elapsedMs(timer, now) : 0) : 0) / 60_000);
    Alert.alert("End session?", min ? `${min} min will be saved.` : "Nothing is saved yet.", [
      { text: "Keep going", style: "cancel" },
      { text: "End", style: "destructive", onPress: stopFocus },
    ]);
  };

  return (
    <View style={[s.page, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}>
      <View style={s.top}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Hide focus" style={s.hide}>
          <Icon name="chevron-down" size={22} color={c.accentText} />
          <Text style={{ color: c.accentText, fontSize: 16, fontWeight: "500" }}>Hide</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={s.body}>
        {!active ? <Segmented value={mode} options={[{ value: "pomodoro", label: "Timer" }, { value: "stopwatch", label: "Stopwatch" }]} onChange={setMode} style={{ alignSelf: "stretch" }} /> : null}
        <Pressable onPress={active ? undefined : () => void pickTask()} disabled={active} accessibilityRole="button" accessibilityLabel={onTask ? `On ${onTask.title}${active ? "" : ". Change task"}` : "Choose a task"} style={s.task}>
          <Text variant="heading" numberOfLines={3} style={{ textAlign: "center", color: onTask ? c.fg : c.muted, textDecorationLine: onTask?.deletedAt ? "line-through" : "none" }}>
            {onTask ? onTask.title : active ? "Focus" : "Choose a task"}
          </Text>
          {!active ? <Icon name="chevron-down" size={18} color={c.muted} /> : null}
        </Pressable>
        <Text variant="timer" accessibilityRole="timer" style={{ textAlign: "center", color: timer.status === "paused" ? c.muted : c.fg }}>
          {clock(shown)}
        </Text>
        <Text variant="secondary" style={{ color: c.fg2, textAlign: "center" }}>
          {status}
        </Text>
      </ScrollView>
      <View style={s.buttons}>
        {!active ? (
          <Button label="Start" icon="play" onPress={() => startFocus(mode, taskId)} style={s.big} />
        ) : (
          <>
            {timer.status === "running" ? <Button label="Pause" icon="pause" onPress={pauseFocus} style={s.big} /> : <Button label="Resume" icon="play" onPress={resumeFocus} style={s.big} />}
            <View style={{ flexDirection: "row", gap: 10 }}>
              {timer.mode === "pomodoro" ? <Button label="Skip" icon="skip-forward" kind="outline" onPress={skipPhase} style={{ flex: 1 }} /> : null}
              <Button label="Stop" icon="square" kind="outline" onPress={stop} style={{ flex: 1 }} />
            </View>
          </>
        )}
        {focusedToday ? (
          <Text variant="meta" style={{ color: c.muted, textAlign: "center", paddingTop: 8 }}>
            {focusedToday}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1 },
  top: { flexDirection: "row", paddingHorizontal: 8, minHeight: 48, alignItems: "center" },
  hide: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, paddingHorizontal: 8 },
  body: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: GUTTER, gap: 16 },
  task: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingTop: 24 },
  buttons: { paddingHorizontal: GUTTER, gap: 10 },
  big: { minHeight: 56 },
});

