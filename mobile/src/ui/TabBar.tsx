import type { BottomTabBarProps } from "expo-router/tabs";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/theme";
import { FocusBar } from "./FocusBar";
import { Icon, Text, type IconName } from "./kit";
import { openQuickAdd } from "./QuickAdd";

const TABS: Record<string, { title: string; icon: IconName }> = {
  index: { title: "Today", icon: "sun" },
  calendar: { title: "Calendar", icon: "calendar" },
  habits: { title: "Habits", icon: "target" },
  browse: { title: "Browse", icon: "list" },
};

/** Today · Calendar · + · Habits · Browse (D254). The + isn't a route: it opens quick add from any tab. */
export function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const item = (index: number) => {
    const route = state.routes[index];
    const tab = TABS[route.name];
    if (!tab) return null;
    const on = state.index === index;
    return (
      <Pressable
        key={route.key}
        onPress={() => !on && navigateToTab(route.key)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={tab.title}
        style={s.tab}
      >
        <Icon name={tab.icon} size={22} color={on ? c.accentText : c.muted} />
        <Text variant="tab" style={{ color: on ? c.accentText : c.muted }}>
          {tab.title}
        </Text>
      </Pressable>
    );
  };
  return (
    <View>
      <FocusBar />
      <View style={[s.bar, { backgroundColor: c.bg, borderColor: c.border, paddingBottom: insets.bottom }]} accessibilityRole="tablist">
        {item(0)}
        {item(1)}
        <View style={s.tab}>
          <Pressable onPress={openQuickAdd} accessibilityRole="button" accessibilityLabel="Add task" style={({ pressed }) => [s.fab, { backgroundColor: c.accent }, pressed && { opacity: 0.9, transform: [{ scale: 0.96 }] }]}>
            <Icon name="plus" size={26} color={c.accentFg} />
          </Pressable>
        </View>
        {item(2)}
        {item(3)}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, minHeight: 52 },
  fab: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
});
