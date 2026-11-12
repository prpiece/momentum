import { router } from "expo-router";
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HabitFrequency, HabitGoal } from "@core/domain/habits";
import { parseQuickAdd } from "@core/domain/quickAdd";
import { setLocalState } from "@core/lib/sync/engine";
import { addHabit } from "@core/stores/habits";
import { createFromText, listNames } from "@core/stores/quickAddSubmit";
import { FONTS, GUTTER, useColors } from "@/theme";
import { tick } from "@/ui/haptics";
import { Button, Icon, Text } from "@/ui/kit";

const EXAMPLES = ["Call mum tomorrow 6pm", "Gym every Mon Wed", "Groceries #errand"];
const HABITS: { name: string; sub: string; goal: HabitGoal; frequency: HabitFrequency; color: string }[] = [
  { name: "Drink water", sub: "8 glasses a day", goal: { kind: "count", target: 8, unit: "glasses" }, frequency: { kind: "daily" }, color: "var(--h-blue)" },
  { name: "Read", sub: "20 minutes a day", goal: { kind: "amount", target: 20, unit: "min" }, frequency: { kind: "daily" }, color: "var(--h-violet)" },
  { name: "Exercise", sub: "3 times a week", goal: { kind: "once" }, frequency: { kind: "perWeek", count: 3 }, color: "var(--h-coral)" },
  { name: "Less social media", sub: "At most 30 minutes a day", goal: { kind: "limit", cap: 30, unit: "min" }, frequency: { kind: "daily" }, color: "var(--h-amber)" },
];

/** First run (S14): welcome, a first task that teaches the parser, an optional starter habit, then Today. No account, no permission asks. */
export default function Welcome() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<"welcome" | "task" | "habit">("welcome");
  const [text, setText] = useState("");
  const [habit, setHabit] = useState(0);
  const chips = useMemo(() => (text.trim() ? parseQuickAdd(text, new Date(), true, listNames()).chips : []), [text]);
  const finish = (how: "new" | "existing" = "new") => {
    void setLocalState("onboarded", how);
    router.replace("/");
  };
  const skip = (next: () => void) => (
    <Pressable onPress={next} accessibilityRole="button" style={s.skip}>
      <Text style={{ color: c.fg2, fontSize: 15, fontWeight: "500" }}>Skip</Text>
    </Pressable>
  );

  if (step === "welcome")
    return (
      <View style={[s.page, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}>
        <View style={{ flex: 1, justifyContent: "center", gap: 16 }}>
          <Text variant="display" style={{ fontSize: 40, lineHeight: 46 }} accessibilityRole="header">
            Plan the day. Keep the habit.
          </Text>
          <Text variant="secondary" style={{ color: c.fg2, fontSize: 17, lineHeight: 25 }}>
            Tasks, calendar, habits and a focus timer in one place. Everything stays on this phone and works offline. Sync is optional.
          </Text>
        </View>
        <Button label="Get started" onPress={() => setStep("task")} style={{ minHeight: 52 }} />
        <Pressable onPress={() => (finish("existing"), router.push("/account"))} accessibilityRole="button" style={s.link}>
          <Text style={{ color: c.accentText, fontSize: 15, fontWeight: "500", textAlign: "center" }}>I use Momentum on a computer · Sign in</Text>
        </Pressable>
      </View>
    );

  if (step === "task")
    return (
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={[s.page, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
          <View style={s.bar}>{skip(() => setStep("habit"))}</View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
            <Text variant="title" style={{ fontSize: 28, lineHeight: 34 }} accessibilityRole="header">
              What's one thing you need to do?
            </Text>
            <Text variant="secondary" style={{ color: c.fg2 }}>
              Write it the way you'd say it. Dates, priority and tags are picked out as you type.
            </Text>
            <TextInput
              value={text}
              onChangeText={setText}
              autoFocus
              placeholder="Hand in the lab report Friday 9am !high"
              placeholderTextColor={c.muted}
              maxFontSizeMultiplier={2}
              style={[s.input, { color: c.fg, borderColor: c.border, backgroundColor: c.raised }]}
              accessibilityLabel="Your first task"
            />
            {chips.length ? (
              <View style={s.chips}>
                {chips.map((ch) => (
                  <View key={`${ch.kind}${ch.start}`} style={[s.chip, { backgroundColor: c.accentSoft }]}>
                    <Icon name={ch.kind === "date" ? "calendar" : ch.kind === "priority" ? "flag" : ch.kind === "repeat" ? "repeat" : ch.kind === "list" ? "list" : "hash"} size={14} color={c.fg} />
                    <Text style={{ fontSize: 14, fontWeight: "500" }}>{ch.text}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <Text variant="meta" style={{ color: c.muted, marginTop: 8 }}>
              Or try one:
            </Text>
            <View style={s.chips}>
              {EXAMPLES.map((e) => (
                <Pressable key={e} onPress={() => setText(e)} accessibilityRole="button" style={[s.example, { borderColor: c.border }]}>
                  <Text style={{ fontSize: 14 }}>{e}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <Button
            label="Add task"
            disabled={!text.trim()}
            style={{ minHeight: 52 }}
            onPress={() => {
              if (createFromText(text, {}, true, () => false)) (tick(), setStep("habit"));
            }}
          />
        </View>
      </KeyboardAvoidingView>
    );

  const h = HABITS[habit];
  return (
    <View style={[s.page, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <View style={s.bar}>{skip(() => finish())}</View>
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        <Text variant="title" style={{ fontSize: 28, lineHeight: 34 }} accessibilityRole="header">
          Something to do every day?
        </Text>
        <Text variant="secondary" style={{ color: c.fg2 }}>
          Habits sit beside your tasks and keep a streak. Pick one to start, or skip; you can add more later.
        </Text>
        <View style={{ gap: 8, marginTop: 8 }}>
          {HABITS.map((x, i) => (
            <Pressable key={x.name} onPress={() => setHabit(i)} accessibilityRole="radio" accessibilityState={{ selected: i === habit }} style={[s.option, { borderColor: i === habit ? c.accentText : c.border, backgroundColor: i === habit ? c.accentSoft : c.surface }]}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{x.name}</Text>
                <Text variant="meta" style={{ color: c.muted }}>
                  {x.sub}
                </Text>
              </View>
              {i === habit ? <Icon name="check" color={c.accentText} /> : null}
            </Pressable>
          ))}
          <Pressable onPress={() => (finish(), router.push({ pathname: "/habit/[id]", params: { id: "new" } }))} accessibilityRole="button" style={[s.option, { borderColor: c.border }]}>
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              Something else…
            </Text>
            <Icon name="chevron-right" size={18} color={c.muted} />
          </Pressable>
        </View>
      </ScrollView>
      <Button
        label={`Start with ${h.name}`}
        style={{ minHeight: 52 }}
        onPress={() => {
          addHabit({ name: h.name, goal: h.goal, frequency: h.frequency, color: h.color });
          tick();
          finish();
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: GUTTER, gap: 12 },
  bar: { flexDirection: "row", justifyContent: "flex-end", minHeight: 44 },
  skip: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  link: { minHeight: 44, justifyContent: "center" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, minHeight: 56, fontSize: 18, fontFamily: FONTS[400], marginTop: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32, paddingHorizontal: 10, borderRadius: 6 },
  example: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 6, borderWidth: 1 },
  option: { flexDirection: "row", alignItems: "center", minHeight: 64, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
});
