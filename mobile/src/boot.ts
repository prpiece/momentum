/*
 * Plugs the phone's pieces into the shared core (PLAN D229) and loads the stores. Desktop does the
 * same in src/main.tsx with Tauri's SQL plugin, the OS keychain and Sonner.
 */
import { randomUUID } from "expo-crypto";
import { Platform, ToastAndroid } from "react-native";
import { setDriver, write } from "@core/db/client";
import { setSnapshot } from "@core/lib/sync/engine";
import { hydrate } from "@core/stores/data";
import { hydrateFocus } from "@core/stores/focus";
import { hydrateHabits } from "@core/stores/habits";
import { hydrateProgress } from "@core/stores/progress";
import { useSettings } from "@core/stores/settings";
import { setToast } from "@core/stores/toast";
import { databasePath, openDatabase } from "./db/sqlite";

// Hermes may lack crypto.randomUUID, which the stores use for every new id.
const g = globalThis as { crypto?: { randomUUID?: () => string } };
g.crypto ??= {};
g.crypto.randomUUID ??= randomUUID;

// ponytail: Android's system toast, no Undo button; the real toast comes with the task screens (C6).
setToast((message) => (Platform.OS === "android" ? ToastAndroid.show(message, ToastAndroid.SHORT) : console.info(message)));

setDriver(openDatabase);
setSnapshot((reason) => write(["VACUUM INTO $1", [`${databasePath()}.${reason}-${Date.now()}.db`]]));

export const ready = Promise.all([useSettings.getState().hydrate(), hydrate(), hydrateHabits(), hydrateFocus(), hydrateProgress()]);
