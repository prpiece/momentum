/*
 * Plugs the phone's pieces into the shared core (PLAN D229) and loads the stores. Desktop does the
 * same in src/main.tsx with Tauri's SQL plugin, the OS keychain and Sonner.
 */
import { getRandomValues, randomUUID } from "expo-crypto";
import { addNetworkStateListener, getNetworkStateAsync } from "expo-network";
import * as SecureStore from "expo-secure-store";
import { Alert, AppState, Platform } from "react-native";
import { setDriver, write } from "@core/db/client";
import { setSnapshot, setSyncHost, startSync } from "@core/lib/sync/engine";
import { configureSync, supabase } from "@core/lib/sync/supabase";
import { hydrate } from "@core/stores/data";
import { hydrateFocus } from "@core/stores/focus";
import { hydrateHabits } from "@core/stores/habits";
import { hydrateProgress } from "@core/stores/progress";
import { useSettings } from "@core/stores/settings";
import { router } from "expo-router";
import { setScopeAsker } from "@core/stores/ask";
import { setTaskOpener } from "@core/stores/quickAddSubmit";
import { setToast } from "@core/stores/toast";
import { showToast } from "./ui/Toast";
import { databasePath, openDatabase } from "./db/sqlite";

// Hermes may lack Web Crypto: the stores use randomUUID for every new id, Supabase's sign-in getRandomValues.
const g = globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: typeof getRandomValues } };
g.crypto ??= {};
g.crypto.randomUUID ??= randomUUID;
g.crypto.getRandomValues ??= getRandomValues;

setToast(showToast);
setTaskOpener((id) => router.push({ pathname: "/task/[id]", params: { id, key: "" } }));
// "Which occurrences?" for recurring tasks and events, as a native alert.
setScopeAsker(
  (verb) =>
    new Promise((resolve) =>
      Alert.alert(verb === "edit" ? "Change which occurrences?" : "Delete which occurrences?", undefined, [
        { text: "Only this one", onPress: () => resolve("this") },
        { text: "This and following", onPress: () => resolve("following") },
        { text: "All", onPress: () => resolve("all") },
        // Android shows at most three buttons: there, tapping outside cancels.
        ...(Platform.OS === "ios" ? [{ text: "Cancel", style: "cancel" as const, onPress: () => resolve(null) }] : []),
      ], { cancelable: true, onDismiss: () => resolve(null) }),
    ),
);

setDriver(openDatabase);
setSnapshot((reason) => write(["VACUUM INTO $1", [`${databasePath()}.${reason}-${Date.now()}.db`]]));

// The refresh token lives in the Keychain / Android Keystore; the session stays in memory (D226).
const TOKEN = "refresh_token";
configureSync(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  get: () => SecureStore.getItemAsync(TOKEN),
  set: (value) => SecureStore.setItemAsync(TOKEN, value),
  delete: () => SecureStore.deleteItemAsync(TOKEN),
});

// A suspended app runs no timers: refresh tokens only while in front, and sync on coming back
// (and when the network returns). Pending changes push on the next run.
let online = true;
void getNetworkStateAsync().then((n) => (online = n.isConnected !== false));
setSyncHost({
  platform: Platform.OS === "ios" ? "iOS" : "Android",
  online: () => online,
  watch: (sync) => {
    const net = addNetworkStateListener((n) => {
      const was = online;
      online = n.isConnected !== false;
      if (online && !was) sync();
    });
    const app = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        void supabase.auth.startAutoRefresh();
        sync();
      } else void supabase.auth.stopAutoRefresh();
    });
    return () => {
      net.remove();
      app.remove();
    };
  },
});

export const ready = Promise.all([useSettings.getState().hydrate(), hydrate(), hydrateHabits(), hydrateFocus(), hydrateProgress()]).then(() => startSync());
