import { Column, Text } from "@expo/ui/jetpack-compose";
import { fillMaxSize, paddingAll } from "@expo/ui/jetpack-compose/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import type { TodayWidgetProps } from "@core/domain/todayWidget";

const initial: TodayWidgetProps = { items: [], more: 0 };

// ponytail: expo-widgets' Android layer has no open-URL action (buttons only run widget-side JS), so this widget only displays; adding a task is the launcher shortcut (plugins/with-add-shortcut).
const Today = (props: TodayWidgetProps, _env: WidgetEnvironment) => {
  "widget";
  return (
    <Column modifiers={[fillMaxSize(), paddingAll(12)]}>
      <Text>Today</Text>
      {props.items.length === 0 ? <Text>All clear for today</Text> : null}
      {props.items.map((it) => (
        <Text key={it.url} maxLines={1}>{it.title}</Text>
      ))}
      {props.more > 0 ? <Text>{`+${props.more} more`}</Text> : null}
    </Column>
  );
};

const today = createWidget("Today", Today, initial);

export function updateTodayWidgets(props: TodayWidgetProps, _next?: { date: Date; props: TodayWidgetProps }) {
  today.updateSnapshot(props);
}
