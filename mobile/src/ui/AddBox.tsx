import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { parseQuickAdd } from "@core/domain/quickAdd";
import type { NewTask } from "@core/stores/data";
import { createFromText, listNames } from "@core/stores/quickAddSubmit";
import { Field } from "./kit";
import { useColors } from "@/theme";

/**
 * Quick add with the desktop's tokens (dates, !priority, #tag, ~list, every …). Chips show what
 * was understood as you type (D219). Enter adds and keeps the field ready for the next task.
 */
export function AddBox({ defaults = {}, placeholder = "Add a task" }: { defaults?: Partial<NewTask>; placeholder?: string }) {
  const c = useColors();
  const [text, setText] = useState("");
  const chips = useMemo(() => (text.trim() ? parseQuickAdd(text, new Date(), true, listNames()).chips : []), [text]);
  const add = () => {
    if (createFromText(text, defaults, true, () => false)) setText("");
  };
  return (
    <View style={s.wrap}>
      <Field value={text} onChangeText={setText} onSubmitEditing={add} submitBehavior="submit" returnKeyType="done" placeholder={placeholder} accessibilityLabel="Add a task" />
      {chips.length ? (
        <View style={s.chips}>
          {chips.map((ch) => (
            <Text key={`${ch.kind}${ch.start}`} style={[s.chip, { backgroundColor: c.accentSoft, color: c.fg }]}>
              {ch.kind === "tag" ? `#${ch.value ?? ch.text.replace(/^#/, "")}` : ch.text}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, fontSize: 13, overflow: "hidden" },
});
