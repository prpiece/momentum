import { Platform, ScrollView, type ScrollViewProps } from "react-native";
import { useKeyboardHeight } from "./Sheet";

/** A ScrollView the keyboard never covers (MOB-13): iOS insets itself; Android (edge-to-edge) gets bottom padding as tall as the keyboard. */
export function KeyboardScroll({ contentContainerStyle, ...props }: ScrollViewProps) {
  const kb = useKeyboardHeight();
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      {...props}
      contentContainerStyle={[contentContainerStyle, Platform.OS === "android" && kb ? { paddingBottom: kb + 16 } : null]}
    />
  );
}
