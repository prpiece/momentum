import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ready } from "@/boot";
import { startReminders } from "@/notify";
import { useColors } from "@/theme";
import { PickerHost } from "@/ui/pickDate";
import { ToastHost } from "@/ui/Toast";

export default function RootLayout() {
  const c = useColors();
  const [state, setState] = useState<"loading" | "ok" | Error>("loading");
  useEffect(() => {
    ready.then(() => setState("ok"), (e: unknown) => setState(e instanceof Error ? e : new Error(String(e))));
  }, []);
  // After the Stack mounts, so a tapped notification can navigate.
  useEffect(() => {
    if (state === "ok") return startReminders();
  }, [state]);

  if (state !== "ok")
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
        {state === "loading" ? <ActivityIndicator color={c.accent} /> : <Text style={{ color: c.fg }}>Couldn't open your data: {state.message}</Text>}
      </View>
    );

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar style={c.mode === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerStyle: { backgroundColor: c.bg }, headerTintColor: c.fg, headerShadowVisible: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="task/[id]" options={{ title: "Task", presentation: "modal" }} />
        <Stack.Screen name="event/[id]" options={{ title: "Event", presentation: "modal" }} />
        <Stack.Screen name="habit/[id]" options={{ title: "Habit", presentation: "modal" }} />
        <Stack.Screen name="list/[id]" options={{ title: "" }} />
        <Stack.Screen name="account" options={{ title: "Account" }} />
        <Stack.Screen name="search" options={{ title: "Search" }} />
        <Stack.Screen name="focus" options={{ title: "Focus" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
      </Stack>
      <ToastHost />
      <PickerHost />
    </GestureHandlerRootView>
  );
}
