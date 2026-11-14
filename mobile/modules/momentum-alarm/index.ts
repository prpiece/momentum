import { requireNativeModule } from "expo";
import { Platform } from "react-native";

export type Alarm = { id: string; at: number; title: string; body: string; url: string };

type Native = {
  canUseFullScreenIntent(): boolean;
  openFullScreenIntentSettings(): void;
  setAlarms(alarms: Alarm[]): void;
};

/** Android only: iOS gets time-sensitive notifications instead, so there is nothing to call. */
const native = Platform.OS === "android" ? requireNativeModule<Native>("MomentumAlarm") : null;

export const alarmsSupported = native !== null;
/** Below Android 14 the manifest permission is enough; on 14+ the user grants it in settings. */
export const canUseFullScreenIntent = () => native?.canUseFullScreenIntent() ?? false;
export const openFullScreenIntentSettings = () => native?.openFullScreenIntentSettings();
/** Replaces every previously set alarm with these. ponytail: AlarmManager forgets them on reboot until the app next opens; add a BOOT_COMPLETED receiver if that bites. */
export const setAlarms = (alarms: Alarm[]) => native?.setAlarms(alarms);
