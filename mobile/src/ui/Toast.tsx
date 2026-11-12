import { useEffect } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import type { ToastAction } from "@core/stores/toast";
import { useColors } from "@/theme";
import { FOCUS_BAR, useFocusActive } from "./FocusBar";
import { Text } from "./kit";

type Shown = { id: number; message: string; action?: ToastAction; ms: number };
const useToast = create<{ shown: Shown | null }>(() => ({ shown: null }));
let next = 0;

/** What the shared stores call through `setToast` (boot.ts): one toast at a time, Undo-style actions stay 6 s. */
export function showToast(message: string, action?: ToastAction, ms = action ? 6000 : 3500) {
  useToast.setState({ shown: { id: ++next, message, action, ms } });
  AccessibilityInfo.announceForAccessibility(action ? `${message}. ${action.label} available.` : message);
}

/** Inverted (fg on surface) so it reads over anything, above the tab bar and the focus bar (04 §3). */
export function ToastHost() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const shown = useToast((s) => s.shown);
  const lift = useFocusActive() ? FOCUS_BAR + 6 : 0;
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => useToast.setState((s) => (s.shown?.id === shown.id ? { shown: null } : s)), shown.ms);
    return () => clearTimeout(t);
  }, [shown]);
  if (!shown) return null;
  return (
    <View pointerEvents="box-none" style={[s.wrap, { bottom: insets.bottom + 84 + lift }]}>
      <Animated.View key={shown.id} entering={FadeInDown.duration(180)} exiting={FadeOut.duration(150)} style={[s.toast, { backgroundColor: c.fg }]} accessibilityLiveRegion="polite">
        <Text style={[s.text, { color: c.surface }]}>{shown.message}</Text>
        {shown.action ? (
          <Pressable
            onPress={() => {
              shown.action?.run();
              useToast.setState({ shown: null });
            }}
            accessibilityRole="button"
            style={s.action}
          >
            <Text style={{ color: c.surface, fontWeight: "600", fontSize: 15, textDecorationLine: "underline" }}>{shown.action.label}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  toast: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingLeft: 16, paddingRight: 4, maxWidth: "100%", minHeight: 48, elevation: 8, shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  text: { fontSize: 15, paddingVertical: 12, flexShrink: 1 },
  action: { paddingHorizontal: 12, minHeight: 44, justifyContent: "center" },
});
