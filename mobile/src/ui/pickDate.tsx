import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { create } from "zustand";
import { useColors } from "@/theme";
import { Text } from "./kit";

type Ask = { mode: "date" | "time"; value: Date; resolve: (d: Date | null) => void };
const useAsk = create<{ ask: Ask | null }>(() => ({ ask: null }));

/** The platform's own date or time picker. Resolves null when dismissed. */
export function pickDate(mode: "date" | "time", value: Date): Promise<Date | null> {
  return new Promise((resolve) => {
    if (Platform.OS === "android")
      DateTimePickerAndroid.open({ mode, value, is24Hour: undefined, onChange: (e, d) => resolve(e.type === "set" && d ? d : null) });
    else useAsk.setState({ ask: { mode, value, resolve } });
  });
}

/** iOS has no picker dialog: show the inline picker in a sheet (render once, in the root layout). */
export function PickerHost() {
  const c = useColors();
  const ask = useAsk((s) => s.ask);
  const [value, setValue] = useState<Date | null>(null);
  if (!ask) return null;
  const close = (d: Date | null) => {
    ask.resolve(d);
    setValue(null);
    useAsk.setState({ ask: null });
  };
  return (
    <Modal transparent animationType="slide" onRequestClose={() => close(null)}>
      <Pressable style={s.scrim} onPress={() => close(null)} />
      <View style={[s.sheet, { backgroundColor: c.raised }]}>
        <DateTimePicker mode={ask.mode} value={value ?? ask.value} display={ask.mode === "date" ? "inline" : "spinner"} onChange={(_, d) => d && setValue(d)} />
        <View style={s.buttons}>
          <Pressable onPress={() => close(null)} style={s.button}>
            <Text style={{ color: c.fg2, fontSize: 16 }}>Cancel</Text>
          </Pressable>
          <Pressable onPress={() => close(value ?? ask.value)} style={s.button}>
            <Text style={{ color: c.accentText, fontSize: 16, fontWeight: "600" }}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)" },
  sheet: { paddingBottom: 32, borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  buttons: { flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingHorizontal: 16 },
  button: { minHeight: 48, paddingHorizontal: 16, justifyContent: "center" },
});
