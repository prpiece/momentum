import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList } from "react-native";
import { relativeDayLabel, todayLocal } from "@core/domain/dates";
import { derive, inSmartList, sortVMs, type TaskVM } from "@core/domain/taskViews";
import { INBOX_ID } from "@core/domain/types";
import { useData } from "@core/stores/data";
import { resolveColor, useColors } from "@/theme";
import { Empty, GroupHeader, IconButton, PageHeader } from "@/ui/kit";
import { listMenu } from "@/ui/listActions";
import { useQuickAddContext } from "@/ui/QuickAdd";
import { TaskRow } from "@/ui/TaskRow";

type Row = { kind: "header"; title: string; key: string; count: number } | { kind: "done"; key: string; count: number } | { kind: "task"; vm: TaskVM; depth: number; key: string };

/** Inbox, Upcoming (by day) or one list (by section, subtasks under their parent, D196), each with a collapsed Done group (S12). */
export default function ListScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const tasks = useData((s) => s.tasks);
  const lists = useData((s) => s.lists);
  const sections = useData((s) => s.sections);
  const [showDone, setShowDone] = useState(false);
  const list = lists[id];
  const title = id === "upcoming" ? "Upcoming" : (list?.name ?? "List");
  useQuickAddContext(id === "upcoming" ? {} : { listId: id ?? INBOX_ID });

  const { rows, open } = useMemo(() => {
    const d = derive(tasks, lists);
    const today = todayLocal();
    const task = (vm: TaskVM, depth = 0): Row => ({ kind: "task", vm, depth, key: `${vm.task.id}${vm.key ?? ""}` });
    if (id === "upcoming") {
      const out: Row[] = [];
      const vms = sortVMs(d.active.filter((v) => inSmartList("upcoming", v, today)), "date");
      for (const vm of vms) {
        const last = out.findLast((r) => r.kind === "header");
        if (last?.key !== `h${vm.date}`) out.push({ kind: "header", title: relativeDayLabel(vm.date!, today), key: `h${vm.date}`, count: vms.filter((v) => v.date === vm.date).length });
        out.push(task(vm));
      }
      return { rows: out, open: vms.length };
    }
    // A list (Inbox included): open top-level tasks by section, each followed by its open subtasks.
    const isOpen = (vm: TaskVM) => vm.task.status === "open";
    const withKids = (vm: TaskVM, depth: number): Row[] => [task(vm, depth), ...sortVMs(d.childrenOf(vm.task.id).filter(isOpen), "manual").flatMap((k) => withKids(k, depth + 1))];
    const mine = d.active.filter((v) => v.task.listId === id && !v.task.parentId);
    const roots = sortVMs(mine.filter(isOpen), "manual");
    const secs = Object.values(sections).filter((s) => s.listId === id).sort((a, b) => a.sortOrder - b.sortOrder);
    const out: Row[] = roots.filter((v) => !v.task.sectionId || !sections[v.task.sectionId]).flatMap((v) => withKids(v, 0));
    for (const s of secs) {
      const inSec = roots.filter((v) => v.task.sectionId === s.id);
      if (inSec.length) out.push({ kind: "header", title: s.name, key: `s${s.id}`, count: inSec.length }, ...inSec.flatMap((v) => withKids(v, 0)));
    }
    const done = mine.filter((v) => !isOpen(v)).sort((a, b) => (b.task.completedAt ?? "").localeCompare(a.task.completedAt ?? ""));
    if (done.length) out.push({ kind: "done", key: "done", count: done.length }, ...(showDone ? done.map((v) => task(v)) : []));
    return { rows: out, open: d.active.filter((v) => v.task.listId === id && isOpen(v)).length };
  }, [id, tasks, lists, sections, showDone]);

  const editable = list && id !== INBOX_ID;
  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.key}
      contentContainerStyle={{ paddingBottom: 24 }}
      ListHeaderComponent={
        <PageHeader
          title={title}
          sub={open ? `${open} open` : undefined}
          back={{ label: "Browse", onPress: () => router.back() }}
          actions={editable ? <IconButton icon="more-horizontal" label={`${title} options`} onPress={() => void listMenu(list, (v) => resolveColor(c, v, c.muted))} /> : null}
        />
      }
      ListEmptyComponent={<Empty text="Nothing here" hint={id === "upcoming" ? "Tasks with a date after today show up here." : `Tap + to add to ${title}.`} />}
      renderItem={({ item }) =>
        item.kind === "header" ? (
          <GroupHeader label={item.title} count={item.count} />
        ) : item.kind === "done" ? (
          <GroupHeader label="Done" count={item.count} collapsed={!showDone} onToggle={() => setShowDone(!showDone)} />
        ) : (
          <TaskRow vm={item.vm} depth={item.depth} showList={id === "upcoming"} />
        )
      }
    />
  );
}
