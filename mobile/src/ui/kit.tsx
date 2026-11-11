/*
 * The phone's small set of building blocks, on the desktop's tokens. Plain on purpose (design
 * tickets D1–D6 come later); every control is at least 44pt tall.
 */
import Feather from "@expo/vector-icons/Feather";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { useColors, type Colors } from "@/theme";

export type IconName = ComponentProps<typeof Feather>["name"];
/** Feather is the set Lucide (desktop's icons) grew from, so both apps share one icon language. */
export const Icon = ({ name, size = 20, color }: { name: IconName; size?: number; color: string }) => <Feather name={name} size={size} color={color} />;

export function Button({ label, onPress, disabled, kind = "primary", icon }: { label: string; onPress: () => unknown; disabled?: boolean; kind?: "primary" | "secondary" | "danger"; icon?: IconName }) {
  const c = useColors();
  const bg = kind === "primary" ? c.accent : kind === "danger" ? c.danger : c.surface2;
  const fg = kind === "primary" ? c.accentFg : kind === "danger" ? "#FFFFFF" : c.fg;
  return (
    <Pressable onPress={() => void onPress()} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} style={[s.button, { backgroundColor: bg }, disabled && { opacity: 0.5 }]}>
      {icon ? <Icon name={icon} size={18} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 16, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

export function Field(props: ComponentProps<typeof TextInput>) {
  const c = useColors();
  return <TextInput placeholderTextColor={c.muted} {...props} style={[s.field, { color: c.fg, backgroundColor: c.surface, borderColor: c.border }, props.style]} />;
}

export const Label = ({ children }: { children: ReactNode }) => {
  const c = useColors();
  return <Text style={[s.label, { color: c.muted }]}>{children}</Text>;
};

/** A tappable row with an icon, a title, optional detail on the right and a chevron. */
export function NavRow({ icon, title, detail, onPress, color }: { icon: IconName; title: string; detail?: string; onPress: () => void; color?: string }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [s.navRow, { borderColor: c.border, backgroundColor: pressed ? c.surface2 : "transparent" }]}>
      <Icon name={icon} color={color ?? c.fg2} />
      <Text style={[s.navTitle, { color: c.fg }]} numberOfLines={1}>
        {title}
      </Text>
      {detail ? <Text style={{ color: c.muted, fontSize: 15 }}>{detail}</Text> : null}
      <Icon name="chevron-right" size={18} color={c.muted} />
    </Pressable>
  );
}

/** A row of mutually exclusive options. */
export function Segmented<T extends string>({ value, options, onChange, style }: { value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View style={[s.seg, { backgroundColor: c.surface2 }, style]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[s.segItem, on && { backgroundColor: c.surface }]}>
            <Text style={{ color: on ? c.fg : c.fg2, fontWeight: on ? "600" : "400", fontSize: 14 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const Empty = ({ text }: { text: string }) => {
  const c = useColors();
  return <Text style={{ color: c.muted, fontSize: 15, paddingVertical: 24, textAlign: "center" }}>{text}</Text>;
};

export const styles = (c: Colors) => ({ text: { color: c.fg }, muted: { color: c.muted } });

const s = StyleSheet.create({
  button: { minHeight: 48, borderRadius: 6, paddingHorizontal: 16, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  field: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, minHeight: 48, fontSize: 16 },
  label: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
  navRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { flex: 1, fontSize: 16 },
  seg: { flexDirection: "row", borderRadius: 8, padding: 3 },
  segItem: { flex: 1, minHeight: 38, borderRadius: 6, alignItems: "center", justifyContent: "center" },
});
