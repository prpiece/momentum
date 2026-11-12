import { Stack } from "expo-router";
import { useColors } from "@/theme";

/** Browse pushes lists and search inside its tab, so the tab bar (and its +) stays. */
export default function BrowseLayout() {
  const c = useColors();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.surface } }} />;
}
