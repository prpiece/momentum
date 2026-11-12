/*
 * The phone's building blocks on the desktop's tokens and the phone type roles
 * (docs/design/mobile/04-system.md). Every control is at least 44pt; text scales with the system size.
 */
import Feather from "@expo/vector-icons/Feather";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, Text as RNText, StyleSheet, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FONTS, GUTTER, INSET, TYPE, useColors, type Role } from "@/theme";

export type IconName = ComponentProps<typeof Feather>["name"];
/** Feather is the set Lucide (desktop's icons) grew from, so both apps share one icon language. */
export const Icon = ({ name, size = 20, color }: { name: IconName; size?: number; color: string }) => <Feather name={name} size={size} color={color} />;

/** Inter at the weight asked for (custom fonts choose weight by family), capped at 2× system text size. */
export function Text({ variant: role, style, ...props }: ComponentProps<typeof RNText> & { variant?: Role }) {
  const c = useColors();
  const flat = (StyleSheet.flatten([{ color: c.fg }, role ? TYPE[role] : null, style]) ?? {}) as TextStyle;
  const w = String(flat.fontWeight ?? "400");
  const fontFamily = flat.fontFamily ?? (w === "500" ? FONTS[500] : w === "400" || w === "normal" ? FONTS[400] : FONTS[600]);
  return <RNText maxFontSizeMultiplier={role === "tab" || role === "timer" ? 1.4 : 2} {...props} style={[flat, { fontFamily, fontWeight: undefined }]} />;
}

export function IconButton({ icon, label, onPress, color, size = 22 }: { icon: IconName; label: string; onPress: () => void; color?: string; size?: number }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={4} style={({ pressed }) => [s.iconButton, pressed && { backgroundColor: c.surface2 }]}>
      <Icon name={icon} size={size} color={color ?? c.fg2} />
    </Pressable>
  );
}

export function Button({ label, onPress, disabled, kind = "primary", icon, style }: { label: string; onPress: () => unknown; disabled?: boolean; kind?: "primary" | "secondary" | "danger" | "outline"; icon?: IconName; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const bg = kind === "primary" ? c.accent : kind === "danger" ? c.danger : kind === "secondary" ? c.surface2 : "transparent";
  const fg = kind === "primary" ? c.accentFg : kind === "danger" ? "#FFFFFF" : c.fg;
  return (
    <Pressable
      onPress={() => void onPress()}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [s.button, { backgroundColor: bg }, kind === "outline" && { borderWidth: 1, borderColor: c.border }, pressed && { opacity: 0.85 }, disabled && { opacity: 0.5 }, style]}
    >
      {icon ? <Icon name={icon} size={18} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 15, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

export function Field(props: ComponentProps<typeof TextInput>) {
  const c = useColors();
  return <TextInput placeholderTextColor={c.muted} maxFontSizeMultiplier={2} {...props} style={[s.field, { color: c.fg, backgroundColor: c.surface, borderColor: c.border }, props.style]} />;
}

/** The 12pt uppercase label. `inset` lines it up with full-width rows. */
export const Label = ({ children, inset }: { children: ReactNode; inset?: boolean }) => {
  const c = useColors();
  return (
    <Text variant="label" style={[s.label, { color: c.muted }, inset && { paddingHorizontal: GUTTER }]}>
      {children}
    </Text>
  );
};

/** A tappable row: an icon (or a colour dot), a title, an optional count and chevron. */
export function NavRow({ icon, dot, title, sub, detail, onPress, onLongPress, indent = 0, chevron }: { icon?: IconName; dot?: string; title: string; sub?: string; detail?: string; onPress: () => void; onLongPress?: () => void; indent?: number; chevron?: IconName }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button" accessibilityLabel={detail ? `${title}, ${detail}` : title} style={({ pressed }) => [s.navRow, { paddingLeft: GUTTER + indent }, pressed && { backgroundColor: c.surface2 }]}>
      {icon ? <Icon name={icon} color={c.fg2} /> : dot ? <View style={[s.dot, { backgroundColor: dot }]} /> : null}
      <View style={{ flex: 1 }}>
        <Text variant="body" numberOfLines={1}>
          {title}
        </Text>
        {sub ? (
          <Text variant="meta" style={{ color: c.muted }}>
            {sub}
          </Text>
        ) : null}
      </View>
      {detail ? <Text style={{ color: c.muted, fontSize: 14, fontVariant: ["tabular-nums"] }}>{detail}</Text> : null}
      {chevron ? <Icon name={chevron} size={16} color={c.muted} /> : null}
    </Pressable>
  );
}

/** A grouped block of rows (task sheet fields, settings). */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[s.card, { borderColor: c.border, backgroundColor: c.surface }, style]}>{children}</View>;
}

/** One field in a Card: icon, name, value and a chevron. `first` drops the divider. */
export function FieldRow({ icon, title, value, valueColor, onPress, first, danger }: { icon: IconName; title: string; value?: string; valueColor?: string; onPress: () => void; first?: boolean; danger?: boolean }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={value ? `${title}: ${value}` : title} style={({ pressed }) => [s.fieldRow, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border }, pressed && { backgroundColor: c.surface2 }]}>
      <Icon name={icon} size={20} color={danger ? c.danger : c.muted} />
      <Text variant="secondary" style={{ flex: 1, color: danger ? c.danger : c.fg }}>
        {title}
      </Text>
      {value !== undefined ? (
        <Text variant="secondary" numberOfLines={1} style={{ color: valueColor ?? (value ? c.muted : c.muted), flexShrink: 1, textAlign: "right" }}>
          {value || "Add"}
        </Text>
      ) : null}
      <Icon name="chevron-right" size={16} color={c.muted} />
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
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[s.segItem, on && { backgroundColor: c.raised }]}>
            <Text style={{ color: on ? c.fg : c.fg2, fontWeight: on ? "600" : "500", fontSize: 14 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A teaching empty state: what's missing and how to add it. */
export const Empty = ({ text, hint }: { text: string; hint?: string }) => {
  const c = useColors();
  return (
    <View style={{ paddingVertical: 40, paddingHorizontal: GUTTER, alignItems: "center", gap: 4 }}>
      <Text variant="bodyStrong" style={{ textAlign: "center" }}>
        {text}
      </Text>
      {hint ? (
        <Text variant="secondary" style={{ color: c.muted, textAlign: "center" }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
};

/** A tab or pushed page's top: actions on the right (and back on the left), then the display title and a sub-line. */
export function PageHeader({ title, sub, actions, back, children }: { title: string; sub?: string; actions?: ReactNode; back?: { label: string; onPress: () => void }; children?: ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 4 }}>
      <View style={s.headerBar}>
        {back ? (
          <Pressable onPress={back.onPress} accessibilityRole="button" accessibilityLabel={`Back to ${back.label}`} style={s.back} hitSlop={4}>
            <Icon name="chevron-left" size={22} color={c.accentText} />
            <Text style={{ color: c.accentText, fontSize: 16, fontWeight: "500" }}>{back.label}</Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }} />
        {actions}
      </View>
      <View style={{ paddingHorizontal: GUTTER, paddingBottom: 8 }}>
        <Text variant="display" accessibilityRole="header">
          {title}
        </Text>
        {sub ? (
          <Text style={{ color: c.muted, fontSize: 14, marginTop: 4, fontVariant: ["tabular-nums"] }}>
            {sub}
          </Text>
        ) : null}
        {children}
      </View>
    </View>
  );
}

/** A group's header: chevron (when collapsible), LABEL, count, and an optional action on the right. */
export function GroupHeader({ label, count, collapsed, onToggle, action }: { label: string; count?: number; collapsed?: boolean; onToggle?: () => void; action?: { label: string; onPress: () => void } }) {
  const c = useColors();
  return (
    <View style={s.group}>
      <Pressable onPress={onToggle} disabled={!onToggle} accessibilityRole={onToggle ? "button" : "header"} accessibilityState={onToggle ? { expanded: !collapsed } : undefined} style={s.groupToggle}>
        {onToggle ? <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={16} color={c.muted} /> : null}
        <Text variant="label" style={{ color: c.muted }}>
          {label}
        </Text>
        {count !== undefined ? <Text style={{ color: c.muted, fontSize: 12, fontWeight: "500", fontVariant: ["tabular-nums"] }}>{count}</Text> : null}
      </Pressable>
      {action ? (
        <Pressable onPress={action.onPress} accessibilityRole="button" style={s.groupAction}>
          <Text style={{ color: c.accentText, fontSize: 14, fontWeight: "500" }}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  iconButton: { width: 44, height: 44, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  button: { minHeight: 48, borderRadius: 6, paddingHorizontal: 16, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  field: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, minHeight: 48, fontSize: 16, fontFamily: FONTS[400] },
  label: { marginTop: 20, marginBottom: 8 },
  navRow: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 48, paddingRight: GUTTER, paddingVertical: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, marginHorizontal: 5 },
  card: { marginHorizontal: INSET, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, overflow: "hidden" },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 14, paddingVertical: 8 },
  seg: { flexDirection: "row", borderRadius: 8, padding: 3 },
  segItem: { flex: 1, minHeight: 38, borderRadius: 6, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, minHeight: 44 },
  back: { flexDirection: "row", alignItems: "center", minHeight: 44, paddingRight: 8 },
  group: { flexDirection: "row", alignItems: "center", paddingLeft: GUTTER, paddingRight: 8, paddingTop: 16, minHeight: 44 },
  groupToggle: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1, minHeight: 44 },
  groupAction: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
});
