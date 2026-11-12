import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/** Light ticks only on complete, check-in and drag pickup (D246, 04 §6). They follow the OS haptics setting. */
export const tick = () =>
  void (Platform.OS === "android" ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm) : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).catch(() => undefined);
export const lift = () =>
  void (Platform.OS === "android" ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press) : Haptics.selectionAsync()).catch(() => undefined);
