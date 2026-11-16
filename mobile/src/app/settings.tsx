import * as Notifications from "expo-notifications";
import { router, useNavigation, usePreventRemove } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { ACCENTS } from "@core/domain/color";
import { discardDraft, saveDraft, useSettingsDraft } from "@core/stores/settingsDraft";
import { useColors } from "@/theme";
import { formatTime } from "@core/domain/dates";
import { Button, Icon, Label, Segmented, Text } from "@/ui/kit";

/** The settings that matter on a phone. They sync, so they match the computer. */
export default function Settings() {
  const c = useColors();
  const { draft: s, update, dirty, save, discard } = useSettingsDraft();
  const nav = useNavigation();
  // Leaving with unsaved changes asks first (D232); a draft nobody saved is dropped when the screen closes.
  usePreventRemove(dirty, ({ data }) =>
    Alert.alert("Save your changes?", "You changed settings that aren't saved yet.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => (discardDraft(), nav.dispatch(data.action)) },
      { text: "Save", onPress: () => (saveDraft(), nav.dispatch(data.action)) },
    ]),
  );
  useEffect(() => discardDraft, []);
  return (
    <View style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={[st.page, dirty && { paddingBottom: 96 }]}>
      <Label>Theme</Label>
      <Segmented value={s.theme} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} onChange={(theme) => update({ theme })} />
      <Label>Accent</Label>
      <View style={st.swatches}>
        {ACCENTS.map((a) => (
          <Pressable key={a.id} onPress={() => update({ accent: a.id })} accessibilityRole="radio" accessibilityState={{ selected: s.accent === a.id }} accessibilityLabel={a.name} style={[st.swatch, { backgroundColor: c.mode === "dark" ? a.dark : a.light }]}>
            {s.accent === a.id ? <Icon name="check" color={c.accentFg} size={18} /> : null}
          </Pressable>
        ))}
      </View>
      <Label>Week starts on</Label>
      <Segmented value={String(s.weekStart)} options={[{ value: "1", label: "Monday" }, { value: "0", label: "Sunday" }, { value: "6", label: "Saturday" }]} onChange={(v) => update({ weekStart: Number(v) as 0 | 1 | 6 })} />
      <Label>Day ends at</Label>
      <Segmented
        value={String(s.dayEndHour)}
        options={[0, 1, 2, 3, 4, 5].map((h) => ({ value: String(h), label: h ? formatTime(new Date(2026, 0, 1, h), s.timeFormat) : "Midnight" }))}
        onChange={(v) => update({ dayEndHour: Number(v) })}
      />
      <Text variant="meta" style={{ color: c.muted, marginTop: 6 }}>
        Before this hour, Today and habits still count as the day before.
      </Text>
      <Label>Time format</Label>
      <Segmented value={s.timeFormat} options={[{ value: "12h", label: "12-hour" }, { value: "24h", label: "24-hour" }]} onChange={(timeFormat) => update({ timeFormat })} />
      <Label>Reminders</Label>
      <View style={st.switchRow}>
        <Text style={{ color: c.fg, fontSize: 16, flex: 1 }}>Notifications</Text>
        <Switch value={s.notify.enabled} onValueChange={(enabled) => update({ notify: { ...s.notify, enabled } })} accessibilityLabel="Notifications" />
      </View>
      {s.notify.enabled ? <Permissions /> : null}
      <View style={st.switchRow}>
        <Text style={{ color: c.fg, fontSize: 16, flex: 1 }}>Streak at risk</Text>
        <Switch value={s.streakReminder.on} onValueChange={(on) => update({ streakReminder: { ...s.streakReminder, on } })} accessibilityLabel="Streak at risk" />
      </View>
      {s.streakReminder.on ? (
        <Segmented
          value={s.streakReminder.time}
          options={[...new Set(["17:00", "18:00", "20:00", "21:00", s.streakReminder.time])].sort().map((t) => ({ value: t, label: t }))}
          onChange={(time) => update({ streakReminder: { ...s.streakReminder, time } })}
        />
      ) : null}
      <View style={st.switchRow}>
        <Text style={{ color: c.fg, fontSize: 16, flex: 1 }}>Start focus at time blocks</Text>
        <Switch value={s.autoFocus} onValueChange={(autoFocus) => update({ autoFocus })} accessibilityLabel="Start focus at time blocks" />
      </View>
      {s.notify.enabled ? (
        <>
          {(
            [
              ["taskReminders", "Task reminders"],
              ["habitReminders", "Habit reminders"],
              ["starts", "Timed tasks and events as they start"],
              ["focus", "Focus timer and time blocks"],
              ["digest", "Daily summary"],
            ] as const
          ).map(([key, label]) => (
            <View key={key} style={st.switchRow}>
              <Text style={{ color: c.fg, fontSize: 16, flex: 1 }}>{label}</Text>
              <Switch value={s.notify[key]} onValueChange={(v) => update({ notify: { ...s.notify, [key]: v } })} accessibilityLabel={label} />
            </View>
          ))}
          {s.notify.digest ? (
            <Segmented
              value={s.notify.digestTime}
              options={[...new Set(["07:00", "08:00", "09:00", s.notify.digestTime])].sort().map((t) => ({ value: t, label: t }))}
              onChange={(digestTime) => update({ notify: { ...s.notify, digestTime } })}
            />
          ) : null}
        </>
      ) : null}
      <Label>Focus timer (minutes)</Label>
      {(
        [
          ["focusMin", "Focus", [15, 25, 45, 50]],
          ["shortMin", "Short break", [3, 5, 10]],
          ["longMin", "Long break", [15, 20, 30]],
        ] as const
      ).map(([key, label, presets]) => (
        <View key={key} style={{ gap: 6, marginBottom: 8 }}>
          <Text variant="meta" style={{ color: c.muted }}>{label}</Text>
          <Segmented
            value={String(s.pomodoro[key])}
            options={[...new Set<number>([...presets, s.pomodoro[key]])].sort((x, y) => x - y).map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(v) => update({ pomodoro: { ...s.pomodoro, [key]: Number(v) } })}
          />
        </View>
      ))}
      <Label>Trash</Label>
      <Button label="Deleted tasks" icon="trash-2" kind="secondary" onPress={() => router.push("/trash" as "/connections") /* typed routes regenerate on the next expo start */} />
      <Label>Connections</Label>
      <Button label="Discord, Slack, Telegram and webhook" icon="link" kind="secondary" onPress={() => router.push("/connections")} />
      <Text style={{ color: c.muted, marginTop: 24, fontSize: 13 }}>These settings sync with your other devices when you're signed in.</Text>
    </ScrollView>
    {dirty ? (
      <View style={[st.bar, { backgroundColor: c.raised, borderColor: c.borderStrong }]} accessibilityRole="alert">
        <Text style={{ color: c.fg, fontSize: 15, fontWeight: "600", flex: 1 }}>Unsaved changes</Text>
        <Button label="Discard" kind="secondary" onPress={discard} />
        <Button label="Save" onPress={save} />
      </View>
    ) : null}
    </View>
  );
}

type Access = { notify: boolean; exact: boolean };
/** What the phone lets reminders do, re-read when the user comes back from system settings. */
function Permissions() {
  const c = useColors();
  const [access, setAccess] = useState<Access | null>(null);
  useEffect(() => {
    const read = async () => {
      const notify = (await Notifications.getPermissionsAsync()).granted;
      const exact = Platform.OS !== "android" || (await Notifications.getExactAlarmPermissionsAsync()).granted;
      setAccess({ notify, exact });
    };
    void read();
    const sub = AppState.addEventListener("change", (st) => st === "active" && void read());
    return () => sub.remove();
  }, []);
  if (!access) return null;
  if (!access.notify)
    return (
      <View style={{ gap: 8 }}>
        <Text style={{ color: c.fg2, fontSize: 15 }}>Momentum isn't allowed to show notifications, so reminders won't appear.</Text>
        <Button label="Open phone settings" kind="secondary" onPress={() => Linking.openSettings()} />
      </View>
    );
  if (!access.exact)
    return (
      <View style={{ gap: 8 }}>
        <Text style={{ color: c.fg2, fontSize: 15 }}>Reminders may arrive a few minutes late. Allow alarms so they go off on time.</Text>
        <Button label="Allow alarms" kind="secondary" onPress={() => void Notifications.requestExactAlarmPermissionsAsync()} />
      </View>
    );
  return <Text style={{ color: c.muted, fontSize: 15 }}>Reminders go off on time, even with the app closed.</Text>;
}

const st = StyleSheet.create({
  switchRow: { flexDirection: "row", alignItems: "center", minHeight: 48 },
  page: { padding: 16 },
  bar: { position: "absolute", left: 16, right: 16, bottom: 16, flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, elevation: 6 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  swatch: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
