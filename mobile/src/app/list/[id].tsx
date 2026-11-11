import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { FlatList } from "react-native";
import { relativeDayLabel, todayLocal } from "@core/domain/dates";
import { derive, inSmartList, sortVMs, type TaskVM } from "@core/domain/taskViews";
import { INBOX_ID } from "@core/domain/types";
import { useData } from "@core/stores/data";
import { AddBox } from "@/ui/AddBox";
import { Empty, Label } from "@/ui/kit";
import { TaskRow } from "@/ui/TaskRow";

type Row = { kind: "header"; title: string; key: string } | { kind: "task"; vm: TaskVM; depth: number; key: string };

/** Inbox, Upcoming (by day) or one list (by section, subtasks under their parent, D196). */
export default function ListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tasks = useData((s) => s.tasks);
  const lists = useData((s) => s.lists);
  const sections = useData((s) => s.sections);
  const title = id === "upcoming" ? "Upcoming" : (lists[id]?.name ?? "List");

  const rows = useMemo<Row[]>(() => {
    const d = derive(tasks, lists);
    const today = todayLocal();
    const task = (vm: TaskVM, depth = 0): Row => ({ kind: "task", vm, depth, key: vm.task.id });
    if (id === "upcoming") {
      const out: Row[] = [];
      let day: string | null = null;
      for (const vm of sortVMs(d.active.filter((v) => inSmartList("upcoming", v, today)), "date")) {
        if (vm.date !== day) out.push({ kind: "header", title: relativeDayLabel((day = vm.date!), today), key: `h${day}` });
        out.push(task(vm));
      }
      return out;
    }
    // A list (Inbox included): open top-level tasks by section, each followed by its open subtasks.
    const open = (vm: TaskVM) => vm.task.status === "open";
    const withKids = (vm: TaskVM, depth: number): Row[] => [task(vm, depth), ...sortVMs(d.childrenOf(vm.task.id).filter(open), "manual").flatMap((k) => withKids(k, depth + 1))];
    const roots = sortVMs(d.active.filter((v) => v.task.listId === id && !v.task.parentId && open(v)), "manual");
    const secs = Object.values(sections).filter((s) => s.listId === id).sort((a, b) => a.sortOrder - b.sortOrder);
    const out: Row[] = roots.filter((v) => !v.task.sectionId || !sections[v.task.sectionId]).flatMap((v) => withKids(v, 0));
    for (const s of secs) {
      const inSec = roots.filter((v) => v.task.sectionId === s.id);
      if (inSec.length) out.push({ kind: "header", title: s.name, key: `s${s.id}` }, ...inSec.flatMap((v) => withKids(v, 0)));
    }
    return out;
  }, [id, tasks, lists, sections]);

  const defaults = id === "upcoming" ? {} : { listId: id ?? INBOX_ID };
  return (
    <>
      <Stack.Screen options={{ title }} />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={<AddBox defaults={defaults} placeholder={`Add to ${title}`} />}
        ListEmptyComponent={<Empty text="No open tasks here." />}
        renderItem={({ item }) => (item.kind === "header" ? <Label>{`    ${item.title}`}</Label> : <TaskRow vm={item.vm} depth={item.depth} showList={id === "upcoming"} />)}
      />
    </>
  );
}
