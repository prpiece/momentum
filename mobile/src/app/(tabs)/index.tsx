import { useMemo } from "react";
import { FlatList } from "react-native";
import { todayLocal } from "@core/domain/dates";
import { derive, inSmartList, sortVMs } from "@core/domain/taskViews";
import { useData } from "@core/stores/data";
import { AddBox } from "@/ui/AddBox";
import { Empty } from "@/ui/kit";
import { TaskRow } from "@/ui/TaskRow";

/** Today: due today and overdue, by time. New tasks default to today (as on desktop). */
export default function Today() {
  const tasks = useData((s) => s.tasks);
  const lists = useData((s) => s.lists);
  const today = todayLocal();
  const vms = useMemo(() => sortVMs(derive(tasks, lists).active.filter((vm) => inSmartList("today", vm, today)), "date"), [tasks, lists, today]);
  return (
    <FlatList
      data={vms}
      keyExtractor={(vm) => vm.task.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<AddBox defaults={{ schedule: { kind: "day", date: today } }} placeholder="Add to today: Call mum 5pm !high" />}
      ListEmptyComponent={<Empty text="Nothing due today." />}
      renderItem={({ item }) => <TaskRow vm={item} />}
    />
  );
}
