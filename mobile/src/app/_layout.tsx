import { BricolageGrotesque_600SemiBold } from "@expo-google-fonts/bricolage-grotesque";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import { useFonts } from "expo-font";
import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { setLocalState, state as localState } from "@core/lib/sync/engine";
import { useData } from "@core/stores/data";
import { useHabits } from "@core/stores/habits";
import { ready } from "@/boot";
import { startReminders } from "@/notify";
import { updatedSinceLastRun } from "@/whatsNew";
import { FONTS, useColors } from "@/theme";
import { PickerHost } from "@/ui/pickDate";
import { QuickAddHost } from "@/ui/QuickAdd";
import { AskHost } from "@/ui/Sheet";
import { ToastHost } from "@/ui/Toast";
import { Text } from "@/ui/kit";

/** First run goes through onboarding (S14); a phone that already has data was set up before it existed. */
async function firstRun(): Promise<boolean> {
  if (await localState("onboarded")) return false;
  const used = Object.keys(useData.getState().tasks).length > 0 || Object.keys(useHabits.getState().habits).length > 0;
  if (used) await setLocalState("onboarded", "existing");
  return !used;
}

export default function RootLayout() {
  const c = useColors();
  const [fonts] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, BricolageGrotesque_600SemiBold, JetBrainsMono_500Medium });
  const [state, setState] = useState<"loading" | "ok" | Error>("loading");
  useEffect(() => {
    ready.then(() => setState("ok"), (e: unknown) => setState(e instanceof Error ? e : new Error(String(e))));
  }, []);
  const ok = state === "ok" && fonts;
  // After the Stack mounts, so a tapped notification can navigate.
  useEffect(() => {
    if (ok) return startReminders();
  }, [ok]);
  // Onboarding on a first run; otherwise, once after an update, What's new.
  useEffect(() => {
    if (!ok) return;
    void firstRun().then((first) => {
      if (first) router.push("/welcome");
      else void updatedSinceLastRun().then((since) => since && router.push({ pathname: "/whats-new", params: { since } }));
    });
  }, [ok]);

  if (!ok)
    return (
      <View style={{ flex: 1, backgroundColor: c.surface, alignItems: "center", justifyContent: "center", padding: 24 }}>
        {state instanceof Error ? <Text style={{ color: c.fg }}>Couldn't open your data: {state.message}</Text> : <ActivityIndicator color={c.accent} />}
      </View>
    );

  const header = { headerStyle: { backgroundColor: c.surface }, headerTintColor: c.accentText, headerTitleStyle: { color: c.fg, fontFamily: FONTS[600] }, headerShadowVisible: false };
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.surface }}>
      <StatusBar style={c.mode === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ ...header, contentStyle: { backgroundColor: c.surface } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="welcome" options={{ headerShown: false, gestureEnabled: false, animation: "fade" }} />
        <Stack.Screen
          name="task/[id]"
          options={{ headerShown: false, presentation: "formSheet", sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true, sheetCornerRadius: 14, contentStyle: { backgroundColor: c.raised } }}
        />
        <Stack.Screen name="event/[id]" options={{ title: "Event", presentation: "modal" }} />
        <Stack.Screen name="habit/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="account" options={{ title: "Account" }} />
        <Stack.Screen name="focus" options={{ headerShown: false, presentation: "fullScreenModal", animation: "slide_from_bottom" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="whats-new" options={{ title: "What's new" }} />
        <Stack.Screen name="report" options={{ title: "Report a problem" }} />
      </Stack>
      <ToastHost />
      <QuickAddHost />
      <AskHost />
      <PickerHost />
    </GestureHandlerRootView>
  );
}

