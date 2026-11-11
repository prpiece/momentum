import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColors } from "@/theme";

export default function RootLayout() {
  const c = useColors();
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: c.bg }, headerTintColor: c.fg, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="index" options={{ title: "Momentum" }} />
      </Stack>
    </>
  );
}
