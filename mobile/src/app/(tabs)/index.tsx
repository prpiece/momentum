import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { fromLocalDate, todayLocal } from "@core/domain/dates";
import { derive, inSmartList, inSmartScope, sortVMs, type TaskVM } from "@core/domain/taskViews";
import { useData } from "@core/stores/data";
import { useColors } from "@/theme";
import { SyncBanner } from "@/ui/Banner";
import { GettingStarted } from "@/ui/GettingStarted";
import { Empty, GroupHeader, IconButton, PageHeader } from "@/ui/kit";
import { useQuickAddContext } from "@/ui/QuickAdd";
import { reschedule } from "@/ui/reschedule";
import { TaskRow } from "@/ui/TaskRow";

type Row = { kind: "group"; id: "overdue" | "today" | "done"; count: number } | { kind: "task"; vm: TaskVM };

/** Today (S1): Overdue, Today and a collapsed Done group, with a progress line. New tasks default to today. */
export default function Today() {
  const c = useColors();
  const tasks = useData((s) => s.tasks);
  const lists = useData((s) => s.lists);
  const today = todayLocal();
  const [showDone, setShowDone] = useState(false);
  useQuickAddContext({ schedule: { kind: "day", date: today } });

  const { overdue, due, done } = useMemo(() => {
    const active = derive(tasks, lists).active;
    const open = sortVMs(active.filter((vm) => inSmartList("today", vm, today)), "date");
    return {
      overdue: open.filter((vm) => vm.date! < today),
      due: open.filter((vm) => vm.date === today),
      done: active.filter((vm) => vm.task.status !== "open" && inSmartScope("today", vm, today)).sort((a, b) => (b.task.completedAt ?? "").localeCompare(a.task.completedAt ?? "")),
    };
  }, [tasks, lists, today]);

  const rows: Row[] = [
    ...(overdue.length ? [{ kind: "group", id: "overdue", count: overdue.length } as const, ...overdue.map((vm) => ({ kind: "task", vm }) as const)] : []),
    ...(due.length ? [{ kind: "group", id: "today", count: due.length } as const, ...due.map((vm) => ({ kind: "task", vm }) as const)] : []),
    ...(done.length ? [{ kind: "group", id: "done", count: done.length } as const, ...(showDone ? done.map((vm) => ({ kind: "task", vm }) as const) : [])] : []),
  ];
  const total = due.length + done.length;
  const date = fromLocalDate(today).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const progress = total ? `${done.length} of ${total} done` : `0 of 0 due today${overdue.length ? ` · ${overdue.length} overdue` : ""}`;

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => (r.kind === "group" ? r.id : `${r.vm.task.id}${r.vm.key ?? ""}`)}
      contentContainerStyle={{ paddingBottom: 24 }}
      ListHeaderComponent={
        <>
          <PageHeader title="Today" sub={`${date} · ${progress}`} actions={<IconButton icon="search" label="Search" onPress={() => router.push("/browse/search")} />}>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: c.surface2, marginTop: 12, overflow: "hidden" }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: done.length }}>
              <View style={{ width: `${total ? (done.length / total) * 100 : 0}%`, height: "100%", backgroundColor: c.success, borderRadius: 2 }} />
            </View>
          </PageHeader>
          <SyncBanner />
          <GettingStarted />
        </>
      }
      ListEmptyComponent={<Empty text="All clear for today" hint="Tap + to add a task. It lands here with today's date." />}
      renderItem={({ item }) =>
        item.kind === "task" ? (
          <TaskRow vm={item.vm} />
        ) : item.id === "overdue" ? (
          <GroupHeader label="Overdue" count={item.count} action={{ label: "Reschedule", onPress: () => void reschedule(overdue.map((vm) => ({ source: "task", id: vm.task.id, key: vm.key }))) }} />
        ) : item.id === "today" ? (
          <GroupHeader label="Today" count={item.count} />
        ) : (
          <GroupHeader label="Done" count={item.count} collapsed={!showDone} onToggle={() => setShowDone(!showDone)} />
        )
      }
    />
  );
}
