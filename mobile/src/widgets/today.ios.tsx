import { HStack, Link, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { containerBackground, font, foregroundStyle, lineLimit, widgetURL } from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import { PlatformColor } from "react-native";
import type { TodayWidgetProps } from "@core/domain/todayWidget";

// Widget layouts run in an isolated runtime: no hooks, no outer constants, only props (expo-widgets docs).
const initial: TodayWidgetProps = { items: [], more: 0 };

/** Home screen: the next three tasks for today, each opens its task; "Add task" opens quick add. */
const Today = (props: TodayWidgetProps, _env: WidgetEnvironment) => {
  "widget";
  return (
    <VStack alignment="leading" spacing={6} modifiers={[containerBackground(PlatformColor("systemBackground"), "widget")]}>
      <HStack>
        <Text modifiers={[font({ size: 13, weight: "semibold" })]}>Today</Text>
        <Spacer />
        <Link label="+ Add" destination="momentum://quickadd" modifiers={[font({ size: 13, weight: "semibold" })]} />
      </HStack>
      {props.items.length === 0 ? <Text modifiers={[font({ size: 13 }), foregroundStyle("secondary")]}>All clear for today</Text> : null}
      {props.items.map((it) => (
        <Link key={it.url} label={it.title} destination={it.url} modifiers={[font({ size: 14 }), lineLimit(1)]} />
      ))}
      {props.more > 0 ? <Text modifiers={[font({ size: 12 }), foregroundStyle("secondary")]}>{`+${props.more} more`}</Text> : null}
      <Spacer />
    </VStack>
  );
};

/** Lock screen: tapping any accessory opens quick add. The rectangular one also shows the next task. */
const TodayLock = (props: TodayWidgetProps, env: WidgetEnvironment) => {
  "widget";
  const family = env.widgetFamily;
  return (
    <VStack alignment="leading" modifiers={[containerBackground(PlatformColor("systemBackground"), "widget"), widgetURL("momentum://quickadd")]}>
      {family === "accessoryCircular" ? (
        <Text modifiers={[font({ size: 24, weight: "semibold" })]}>+</Text>
      ) : family === "accessoryInline" ? (
        <Text>Add task</Text>
      ) : (
        <>
          <Text modifiers={[font({ size: 13, weight: "semibold" })]}>+ Add task</Text>
          <Text modifiers={[font({ size: 12 }), lineLimit(1)]}>{props.items[0]?.title ?? "All clear for today"}</Text>
        </>
      )}
    </VStack>
  );
};

const today = createWidget("Today", Today, initial);
const lock = createWidget("TodayLock", TodayLock, initial);

export function updateTodayWidgets(props: TodayWidgetProps, next?: { date: Date; props: TodayWidgetProps }) {
  if (next) {
    const entries = [{ date: new Date(), props }, next];
    today.updateTimeline(entries);
    lock.updateTimeline(entries);
    return;
  }
  today.updateSnapshot(props);
  lock.updateSnapshot(props);
}
