import { useEffect, useState, type ReactNode } from "react";
import { Dimensions, Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { FONTS, GUTTER, useColors } from "@/theme";
import { Icon, Text, type IconName } from "./kit";

/**
 * A bottom sheet over a scrim (04 §3): springs up, sits above the keyboard, closes on the scrim,
 * the back button or its own controls. For short choices and quick add; task details use the
 * native form sheet instead.
 */
export function Sheet({ visible, onClose, children, label }: { visible: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", paddingBottom: keyboard }}>
        {visible ? (
          <>
            <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]}>
              <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
            </Animated.View>
            <Animated.View
              entering={SlideInDown.springify().damping(26).stiffness(260)}
              exiting={SlideOutDown.duration(180)}
              accessibilityViewIsModal
              accessibilityLabel={label}
              style={[s.sheet, { backgroundColor: c.raised, paddingBottom: keyboard ? 8 : Math.max(insets.bottom, 12) }]}
            >
              <View style={[s.grabber, { backgroundColor: c.borderStrong }]} />
              {children}
            </Animated.View>
          </>
        ) : null}
      </View>
    </Modal>
  );
}

/**
 * The keyboard's height, from the OS events. A Modal's window doesn't resize for the keyboard on
 * Android (edge-to-edge), and neither KeyboardAvoidingView nor Reanimated's tracker sees it there.
 */
function useKeyboardHeight() {
  const [h, setH] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) => setH(Math.max(e.endCoordinates.height, Dimensions.get("screen").height - e.endCoordinates.screenY)));
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setH(0));
    return () => (show.remove(), hide.remove());
  }, []);
  return h;
}

export type Choice<T> = { value: T; label: string; detail?: string; icon?: IconName; color?: string; danger?: boolean; selected?: boolean };
type Ask =
  | { kind: "choose"; title: string; options: Choice<unknown>[]; resolve: (v: unknown) => void }
  | { kind: "text"; title: string; value: string; placeholder: string; confirm: string; resolve: (v: unknown) => void };
const useAsk = create<{ ask: Ask | null }>(() => ({ ask: null }));

/** Pick one option from a sheet. Resolves null when dismissed. */
export const choose = <T,>(title: string, options: Choice<T>[]) =>
  new Promise<T | null>((resolve) => useAsk.setState({ ask: { kind: "choose", title, options, resolve: resolve as (v: unknown) => void } }));
/** Ask for a name (new list, rename). Resolves the trimmed text, or null when dismissed or empty. */
export const askText = (title: string, opts: { value?: string; placeholder?: string; confirm?: string } = {}) =>
  new Promise<string | null>((resolve) =>
    useAsk.setState({ ask: { kind: "text", title, value: opts.value ?? "", placeholder: opts.placeholder ?? "", confirm: opts.confirm ?? "Save", resolve: resolve as (v: unknown) => void } }),
  );

/** Renders `choose` and `askText` (once, in the root layout). */
export function AskHost() {
  const c = useColors();
  const ask = useAsk((s) => s.ask);
  const [text, setText] = useState<string | null>(null);
  const close = (v: unknown) => {
    ask?.resolve(v);
    setText(null);
    useAsk.setState({ ask: null });
  };
  const value = ask?.kind === "text" ? (text ?? ask.value) : "";
  return (
    <Sheet visible={!!ask} onClose={() => close(null)} label={ask?.title ?? ""}>
      {ask ? (
        <>
          <Text variant="heading" style={s.title}>
            {ask.title}
          </Text>
          {ask.kind === "choose" ? (
            <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
              {ask.options.map((o, i) => (
                <Pressable key={i} onPress={() => close(o.value)} accessibilityRole="button" accessibilityState={{ selected: !!o.selected }} style={({ pressed }) => [s.option, pressed && { backgroundColor: c.surface2 }]}>
                  {o.icon ? <Icon name={o.icon} color={o.danger ? c.danger : (o.color ?? c.fg2)} /> : o.color ? <View style={[s.dot, { backgroundColor: o.color }]} /> : null}
                  <Text variant="body" style={{ flex: 1, color: o.danger ? c.danger : c.fg }}>
                    {o.label}
                  </Text>
                  {o.detail ? <Text style={{ color: c.muted, fontSize: 14 }}>{o.detail}</Text> : null}
                  {o.selected ? <Icon name="check" size={18} color={c.accentText} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <View style={{ paddingHorizontal: GUTTER, gap: 12 }}>
              <TextInput
                value={value}
                onChangeText={setText}
                placeholder={ask.placeholder}
                placeholderTextColor={c.muted}
                autoFocus
                selectTextOnFocus
                onSubmitEditing={() => value.trim() && close(value.trim())}
                returnKeyType="done"
                style={[s.input, { color: c.fg, borderColor: c.border, backgroundColor: c.surface }]}
              />
              <Pressable onPress={() => value.trim() && close(value.trim())} disabled={!value.trim()} accessibilityRole="button" style={[s.confirm, { backgroundColor: c.accent, opacity: value.trim() ? 1 : 0.5 }]}>
                <Text style={{ color: c.accentFg, fontWeight: "600", fontSize: 15 }}>{ask.confirm}</Text>
              </Pressable>
            </View>
          )}
        </>
      ) : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  sheet: { borderTopLeftRadius: 14, borderTopRightRadius: 14, paddingTop: 4, elevation: 16, shadowColor: "#14120F", shadowOpacity: 0.14, shadowRadius: 32, shadowOffset: { width: 0, height: -8 } },
  grabber: { width: 36, height: 5, borderRadius: 3, alignSelf: "center", marginTop: 4, marginBottom: 8 },
  title: { paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 8 },
  option: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 52, paddingHorizontal: GUTTER },
  dot: { width: 10, height: 10, borderRadius: 5, marginHorizontal: 5 },
  input: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, minHeight: 48, fontSize: 16, fontFamily: FONTS[400] },
  confirm: { minHeight: 48, borderRadius: 6, alignItems: "center", justifyContent: "center", marginBottom: 4 },
});

