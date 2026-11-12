import { Tabs } from "expo-router";
import { useColors } from "@/theme";
import { TabBar } from "@/ui/TabBar";

/** Today · Calendar · + · Habits · Browse (D254). Each screen draws its own header. */
export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.surface } }}>
      <Tabs.Screen name="index" options={{ title: "Today" }} />
      <Tabs.Screen name="calendar" options={{ title: "Calendar" }} />
      <Tabs.Screen name="habits" options={{ title: "Habits" }} />
      <Tabs.Screen name="browse" options={{ title: "Browse" }} />
    </Tabs>
  );
}
