import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ACCENTS } from "@core/domain/color";
import { useSettings } from "@core/stores/settings";
import { useColors } from "@/theme";
import { Icon, Label, Segmented } from "@/ui/kit";

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
      <Text style={{ color: c.muted, marginTop: 24, fontSize: 13 }}>These settings sync with your other devices when you're signed in.</Text>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  page: { padding: 16 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  swatch: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
