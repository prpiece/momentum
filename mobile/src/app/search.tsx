import { useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { derive } from "@core/domain/taskViews";
import { useData } from "@core/stores/data";
import { Empty, Field } from "@/ui/kit";
import { TaskRow } from "@/ui/TaskRow";

/** Tasks whose title or notes contain every typed word; open ones first. */
export default function Search() {
  const [q, setQ] = useState("");
  const tasks = useData((s) => s.tasks);
  const lists = useData((s) => s.lists);
  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return derive(tasks, lists)
      .active.filter((vm) => {
        const text = `${vm.task.title}\n${vm.task.description}`.toLowerCase();
        return words.every((w) => text.includes(w));
      })
      .sort((a, b) => Number(a.task.status !== "open") - Number(b.task.status !== "open"))
      .slice(0, 100);
  }, [q, tasks, lists]);
  return (
    <FlatList
      data={hits}
      keyExtractor={(vm) => vm.task.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ padding: 16 }}>
          <Field value={q} onChangeText={setQ} placeholder="Search tasks" autoFocus autoCapitalize="none" returnKeyType="search" />
        </View>
      }
      ListEmptyComponent={q.trim() ? <Empty text="No matching tasks." /> : undefined}
      renderItem={({ item }) => <TaskRow vm={item} />}
    />
  );
}
