import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { parseQuickAdd } from "@core/domain/quickAdd";
import { useColors } from "@/theme";

/** C1: proves the desktop's quick-add parser (src/domain) runs on the phone. Replaced by the real Today screen. */
export default function Index() {
  const c = useColors();
  const [text, setText] = useState("Call mum tomorrow 5pm !high #family");
  const parsed = useMemo(() => parseQuickAdd(text, new Date()), [text]);
  const s = parsed.schedule;
  const when = s.kind === "none" ? "No date" : s.kind === "day" ? s.date : `${new Date(s.start).toLocaleString()} – ${new Date(s.end).toLocaleTimeString()}`;

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Add a task"
        placeholderTextColor={c.muted}
        style={[styles.input, { color: c.fg, backgroundColor: c.surface, borderColor: c.border }]}
      />
      <View style={styles.chips}>
        {parsed.chips.map((chip) => (
          <Text key={`${chip.kind}${chip.start}`} style={[styles.chip, { backgroundColor: c.surface2, color: c.fg }]}>
            {chip.kind}: {chip.value ?? chip.text}
          </Text>
        ))}
      </View>
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Row label="Title" value={parsed.title || "—"} c={c} />
        <Row label="When" value={when} c={c} />
        <Row label="Priority" value={parsed.priority ? String(parsed.priority) : "—"} c={c} />
        <Row label="Tags" value={parsed.tags.join(", ") || "—"} c={c} />
        <Row label="Repeat" value={parsed.rule ?? "—"} c={c} />
      </View>
    </ScrollView>
  );
}

function Row({ label, value, c }: { label: string; value: string; c: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: c.muted }]}>{label}</Text>
      <Text style={[styles.value, { color: c.fg }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  input: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, height: 48, fontSize: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, fontSize: 13, overflow: "hidden" },
  card: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 8 },
  row: { flexDirection: "row", gap: 12 },
  label: { width: 72, fontSize: 14 },
  value: { flex: 1, fontSize: 14 },
});
