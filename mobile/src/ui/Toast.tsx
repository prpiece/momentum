import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import type { ToastAction } from "@core/stores/toast";
import { useColors } from "@/theme";

type Shown = { id: number; message: string; action?: ToastAction; ms: number };
const useToast = create<{ shown: Shown | null }>(() => ({ shown: null }));
let next = 0;

/** What the shared stores call through `setToast` (boot.ts): one toast at a time, Undo-style actions stay 6 s. */
export function showToast(message: string, action?: ToastAction, ms = action ? 6000 : 3500) {
  useToast.setState({ shown: { id: ++next, message, action, ms } });
}

export function ToastHost() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const shown = useToast((s) => s.shown);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => useToast.setState((s) => (s.shown?.id === shown.id ? { shown: null } : s)), shown.ms);
    return () => clearTimeout(t);
  }, [shown]);
  if (!shown) return null;
  return (
    <View pointerEvents="box-none" style={[s.wrap, { bottom: insets.bottom + 72 }]}>
      <View style={[s.toast, { backgroundColor: c.raised, borderColor: c.border }]} accessibilityLiveRegion="polite">
        <Text style={[s.text, { color: c.fg }]}>{shown.message}</Text>
        {shown.action ? (
          <Pressable
            onPress={() => {
              shown.action?.run();
              useToast.setState({ shown: null });
            }}
            accessibilityRole="button"
            style={s.action}
          >
            <Text style={{ color: c.accentText, fontWeight: "600", fontSize: 15 }}>{shown.action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  toast: { flexDirection: "row", alignItems: "center", borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingLeft: 12, maxWidth: "100%", elevation: 6, shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  text: { fontSize: 15, paddingVertical: 10, flexShrink: 1 },
  action: { paddingHorizontal: 12, minHeight: 44, justifyContent: "center" },
});
