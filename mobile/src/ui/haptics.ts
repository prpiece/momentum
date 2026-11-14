import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/** Light ticks only on complete, check-in and drag pickup (D246, 04 §6). They follow the OS haptics setting. */
export const tick = () =>
  void (Platform.OS === "android" ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm) : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).catch(() => undefined);
export const lift = () =>
  void (Platform.OS === "android" ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press) : Haptics.selectionAsync()).catch(() => undefined);
/** One selection tick per 15-minute snap while dragging (iOS only, throttled to 60 ms; 04 §6). */
let lastSnap = 0;
export const snapTick = () => {
  const now = Date.now();
  if (Platform.OS === "android" || now - lastSnap < 60) return;
  lastSnap = now;
  void Haptics.selectionAsync().catch(() => undefined);
};
