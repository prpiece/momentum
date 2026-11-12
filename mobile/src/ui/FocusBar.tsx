import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { elapsedMs, remainingMs } from "@core/domain/focus";
import { useData } from "@core/stores/data";
import { pauseFocus, resumeFocus, tickFocus, useFocus } from "@core/stores/focus";
import { useSettings } from "@core/stores/settings";
import { FONTS, useColors } from "@/theme";
import { Icon, Text } from "./kit";

export const clock = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(t / 3600);
  const mm = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
  const ss = String(t % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

export const useFocusActive = () => useFocus((s) => s.timer.status === "running" || s.timer.status === "paused");
export const FOCUS_BAR = 56;

/** While a session runs, a bar over the tab bar on every tab (F6): what it's on, the clock, pause. Tap opens Focus. */
export function FocusBar() {
  const c = useColors();
  const timer = useFocus((s) => s.timer);
  const cfg = useSettings((s) => s.settings.pomodoro);
  const title = useData((s) => (timer.status === "running" || timer.status === "paused") && timer.taskId ? s.tasks[timer.taskId]?.title : undefined);
  const [now, setNow] = useState(Date.now());
  const active = timer.status === "running" || timer.status === "paused";
  useEffect(() => {
    if (!active) return;
    const i = setInterval(() => (tickFocus(), setNow(Date.now())), 1000);
    return () => clearInterval(i);
  }, [active]);
  if (!active) return null;
  const ms = timer.mode === "pomodoro" ? (remainingMs(timer, now, cfg) ?? 0) : elapsedMs(timer, now);
  const running = timer.status === "running";
  const label = title ?? (timer.mode === "pomodoro" ? (timer.phase === "focus" ? "Focus" : "Break") : "Stopwatch");
  return (
    <Pressable onPress={() => router.push("/focus")} accessibilityRole="button" accessibilityLabel={`${label}, ${clock(ms)} ${running ? "left" : "paused"}. Open focus`} style={[s.bar, { backgroundColor: c.raised, borderColor: c.border }]}>
      <Icon name="clock" size={18} color={c.accentText} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontWeight: "500" }}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={1.4} style={{ fontFamily: FONTS.mono, fontSize: 20, fontVariant: ["tabular-nums"], color: running ? c.fg : c.muted }}>
        {clock(ms)}
      </Text>
      <Pressable onPress={running ? pauseFocus : resumeFocus} accessibilityRole="button" accessibilityLabel={running ? "Pause" : "Resume"} style={s.button}>
        <Icon name={running ? "pause" : "play"} size={20} color={c.fg} />
      </Pressable>
    </Pressable>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 10, height: FOCUS_BAR, marginHorizontal: 8, marginBottom: 6, paddingLeft: 14, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, elevation: 6, shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 2 } },
  button: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});

