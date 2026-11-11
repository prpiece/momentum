import { router } from "expo-router";
import { useMemo } from "react";
import { ScrollView } from "react-native";
import { todayLocal } from "@core/domain/dates";
import { derive, inSmartList } from "@core/domain/taskViews";
import { INBOX_ID } from "@core/domain/types";
import { useData } from "@core/stores/data";
import { resolveColor, useColors } from "@/theme";
import { Label, NavRow } from "@/ui/kit";

const open = (id: string) => router.push({ pathname: "/list/[id]", params: { id } });

/** Inbox, Upcoming and the user's lists (folders flattened, as names), with open counts. */
export default function Lists() {
  const c = useColors();
  const tasks = useData((s) => s.tasks);
  const lists = useData((s) => s.lists);
  const folders = useData((s) => s.folders);
  const { counts, inbox, upcoming } = useMemo(() => {
    const today = todayLocal();
    const active = derive(tasks, lists).active;
    const counts = new Map<string, number>();
    for (const vm of active) if (vm.task.status === "open") counts.set(vm.task.listId, (counts.get(vm.task.listId) ?? 0) + 1);
    return { counts, inbox: active.filter((vm) => inSmartList("inbox", vm, today)).length, upcoming: active.filter((vm) => inSmartList("upcoming", vm, today)).length };
  }, [tasks, lists]);
  const userLists = useMemo(
    () =>
      Object.values(lists)
        .filter((l) => l.id !== INBOX_ID && !l.archived)
        .sort((a, b) => (folders[a.folderId ?? ""]?.sortOrder ?? -1) - (folders[b.folderId ?? ""]?.sortOrder ?? -1) || a.sortOrder - b.sortOrder),
    [lists, folders],
  );
  const n = (k: number) => (k ? String(k) : undefined);
  return (
    <ScrollView>
      <NavRow icon="inbox" title="Inbox" detail={n(inbox)} onPress={() => open("inbox")} />
      <NavRow icon="calendar" title="Upcoming" detail={n(upcoming)} onPress={() => open("upcoming")} />
      <NavRow icon="search" title="Search" onPress={() => router.push("/search")} />
      <Label inset>Lists</Label>
      {userLists.map((l) => (
        <NavRow key={l.id} icon="hash" color={resolveColor(c, l.color, c.fg2)} title={l.folderId && folders[l.folderId] ? `${folders[l.folderId].name} / ${l.name}` : l.name} detail={n(counts.get(l.id) ?? 0)} onPress={() => open(l.id)} />
      ))}
    </ScrollView>
  );
}
