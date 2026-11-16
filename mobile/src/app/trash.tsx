import { Alert, FlatList, View } from "react-native";
import { useMemo } from "react";
import { trashItems, TRASH_DAYS } from "@core/domain/trash";
import { purgeTasks, restoreTasks, useData } from "@core/stores/data";
import { toast } from "@core/stores/toast";
import { GUTTER, useColors } from "@/theme";
import { Button, Empty, Text } from "@/ui/kit";

/** Trash (MOB-18): deleted tasks wait here for 30 days, as on the computer. Restore brings back the task with its subtasks. */
export default function Trash() {
  const c = useColors();
  const tasks = useData((s) => s.tasks);
  const items = useMemo(() => trashItems(tasks, Date.now()), [tasks]);
  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.task.id}
      ListEmptyComponent={<Empty text="Trash is empty" hint={`Deleted tasks wait here for ${TRASH_DAYS} days.`} />}
      ListHeaderComponent={
        items.length ? (
          <View style={{ padding: GUTTER }}>
            <Button
              label="Empty trash"
              kind="danger"
              onPress={() =>
                Alert.alert("Empty the trash?", `All ${items.length} deleted ${items.length === 1 ? "task" : "tasks"} are removed for good. This can't be undone.`, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Empty trash", style: "destructive", onPress: () => purgeTasks(items.flatMap((i) => i.ids)) },
                ])
              }
            />
          </View>
        ) : undefined
      }
      renderItem={({ item: { task, ids, daysLeft } }) => (
        <View style={{ paddingHorizontal: GUTTER, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderColor: c.border }}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {task.title}
            {ids.length > 1 ? ` + ${ids.length - 1} subtasks` : ""}
          </Text>
          <Text variant="secondary" style={{ color: c.muted }}>{`${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button label="Restore" kind="secondary" onPress={() => (restoreTasks(ids), toast(`Restored "${task.title}"`))} />
            <Button
              label="Delete forever"
              kind="outline"
              onPress={() =>
                Alert.alert(`Delete "${task.title}" forever?`, "This can't be undone.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete forever", style: "destructive", onPress: () => purgeTasks(ids) },
                ])
              }
            />
          </View>
        </View>
      )}
    />
  );
}
