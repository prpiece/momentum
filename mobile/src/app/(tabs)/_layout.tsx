import { Tabs } from "expo-router";
import type { ColorValue } from "react-native";
import { useColors } from "@/theme";
import { Icon, type IconName } from "@/ui/kit";

const tab = (title: string, icon: IconName) => ({ title, tabBarIcon: ({ color }: { color: ColorValue }) => <Icon name={icon} color={String(color)} size={22} /> });

/** Today, Lists, Calendar, Habits and More (D200's phone bar, as native tabs). */
export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.fg,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: c.bg, borderTopColor: c.border },
        tabBarActiveTintColor: c.accentText,
        tabBarInactiveTintColor: c.muted,
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen name="index" options={tab("Today", "sun")} />
      <Tabs.Screen name="lists" options={tab("Lists", "list")} />
      <Tabs.Screen name="calendar" options={tab("Calendar", "calendar")} />
      <Tabs.Screen name="habits" options={tab("Habits", "target")} />
      <Tabs.Screen name="more" options={tab("More", "menu")} />
    </Tabs>
  );
}
