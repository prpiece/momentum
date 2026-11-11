import * as Notifications from "expo-notifications";
import { useEffect, useState } from "react";
import { AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { ACCENTS } from "@core/domain/color";
import { useSettings } from "@core/stores/settings";
import { useColors } from "@/theme";
import { Button, Icon, Label, Segmented } from "@/ui/kit";

/** The settings that matter on a phone. They sync, so they match the computer. */
export default function Settings() {
  const c = useColors();
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  return (
    <ScrollView contentContainerStyle={st.page}>
      <Label>Theme</Label>
      <Segmented value={s.theme} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} onChange={(theme) => update({ theme })} />
      <Label>Accent</Label>
      <View style={st.swatches}>
        {ACCENTS.map((a) => (
          <Pressable key={a.id} onPress={() => update({ accent: a.id })} accessibilityRole="radio" accessibilityState={{ selected: s.accent === a.id }} accessibilityLabel={a.name} style={[st.swatch, { backgroundColor: c.mode === "dark" ? a.dark : a.light }]}>
            {s.accent === a.id ? <Icon name="check" color={c.mode === "dark" ? "#141519" : "#FFFFFF"} size={18} /> : null}
          </Pressable>
        ))}
      </View>
      <Label>Week starts on</Label>
      <Segmented value={String(s.weekStart)} options={[{ value: "1", label: "Monday" }, { value: "0", label: "Sunday" }, { value: "6", label: "Saturday" }]} onChange={(v) => update({ weekStart: Number(v) as 0 | 1 | 6 })} />
      <Label>Time format</Label>
      <Segmented value={s.timeFormat} options={[{ value: "12h", label: "12-hour" }, { value: "24h", label: "24-hour" }]} onChange={(timeFormat) => update({ timeFormat })} />
      <Label>Reminders</Label>
      <View style={st.switchRow}>
        <Text style={{ color: c.fg, fontSize: 16, flex: 1 }}>Notifications</Text>
        <Switch value={s.notify.enabled} onValueChange={(enabled) => update({ notify: { ...s.notify, enabled } })} accessibilityLabel="Notifications" />
      </View>
      {s.notify.enabled ? <Permissions /> : null}
      <Text style={{ color: c.muted, marginTop: 24, fontSize: 13 }}>These settings sync with your other devices when you're signed in.</Text>
    </ScrollView>
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
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  swatch: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
