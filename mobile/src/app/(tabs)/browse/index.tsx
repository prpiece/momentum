import { router } from "expo-router";
import { useMemo, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { todayLocal } from "@core/domain/dates";
import { derive, inSmartList } from "@core/domain/taskViews";
import { INBOX_ID, type Folder } from "@core/domain/types";
import { statusText } from "@core/lib/sync/account";
import { useSync } from "@core/lib/sync/engine";
import { updateFolder, useData } from "@core/stores/data";
import { GUTTER, INSET, resolveColor, useColors } from "@/theme";
import { Icon, IconButton, Label, NavRow, PageHeader, Text } from "@/ui/kit";
import { folderMenu, listMenu, newListOrFolder } from "@/ui/listActions";
import { useQuickAddContext } from "@/ui/QuickAdd";

const open = (id: string) => router.push({ pathname: "/browse/list/[id]", params: { id } });

/** Browse (D254): search, Inbox and Upcoming, folders and lists (managed here, S2), then Focus, settings and the account. */
export default function Browse() {
  const c = useColors();
  const tasks = useData((s) => s.tasks);
  const lists = useData((s) => s.lists);
  const folders = useData((s) => s.folders);
  const account = useSync((s) => s.account);
  const status = useSync((s) => s.status);
  useQuickAddContext({});
  const { counts, inbox, upcoming } = useMemo(() => {
    const today = todayLocal();
    const active = derive(tasks, lists).active;
    const counts = new Map<string, number>();
    for (const vm of active) if (vm.task.status === "open") counts.set(vm.task.listId, (counts.get(vm.task.listId) ?? 0) + 1);
    return { counts, inbox: active.filter((vm) => inSmartList("inbox", vm, today)).length, upcoming: active.filter((vm) => inSmartList("upcoming", vm, today)).length };
  }, [tasks, lists]);
  const n = (k: number | undefined) => (k ? String(k) : undefined);
  const colorOf = (v: string) => resolveColor(c, v, c.muted);
  const visible = Object.values(lists).filter((l) => l.id !== INBOX_ID && !l.archived);

  const tree = (parent: string | null, depth: number): ReactNode[] => [
    ...Object.values(folders)
      .filter((f) => f.parentId === parent)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .flatMap((f: Folder) => [
        <Pressable
          key={f.id}
          onPress={() => updateFolder(f.id, { collapsed: !f.collapsed })}
          onLongPress={() => void folderMenu(f)}
          accessibilityRole="button"
          accessibilityState={{ expanded: !f.collapsed }}
          accessibilityHint="Press and hold for folder options"
          style={({ pressed }) => [s.folder, { paddingLeft: GUTTER + depth * 28 }, pressed && { backgroundColor: c.surface2 }]}
        >
          <Icon name="folder" color={c.fg2} />
          <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
            {f.name}
          </Text>
          <Icon name={f.collapsed ? "chevron-right" : "chevron-down"} size={16} color={c.muted} />
        </Pressable>,
        ...(f.collapsed ? [] : tree(f.id, depth + 1)),
      ]),
    ...visible
      .filter((l) => (l.folderId && folders[l.folderId] ? l.folderId : null) === parent)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((l) => <NavRow key={l.id} dot={resolveColor(c, l.color, c.muted)} title={l.name} detail={n(counts.get(l.id))} indent={depth * 28} onPress={() => open(l.id)} onLongPress={() => void listMenu(l, colorOf)} />),
  ];

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
      <PageHeader title="Browse" />
      <Pressable onPress={() => router.push("/browse/search")} accessibilityRole="search" accessibilityLabel="Search tasks" style={[s.search, { backgroundColor: c.surface2 }]}>
        <Icon name="search" color={c.muted} />
        <Text variant="body" style={{ color: c.muted }}>
          Search tasks
        </Text>
      </Pressable>
      <NavRow icon="inbox" title="Inbox" detail={n(inbox)} onPress={() => open(INBOX_ID)} />
      <NavRow icon="calendar" title="Upcoming" detail={n(upcoming)} onPress={() => open("upcoming")} />
      <View style={s.listsHead}>
        <View style={{ flex: 1 }}>
          <Label inset>Lists</Label>
        </View>
        <IconButton icon="plus" label="New list or folder" onPress={() => void newListOrFolder()} />
      </View>
      {tree(null, 0)}
      {visible.length ? null : (
        <Text variant="meta" style={{ color: c.muted, paddingHorizontal: GUTTER, paddingVertical: 8 }}>
          Group tasks into lists, like Chemistry or Home. Tap + to make one.
        </Text>
      )}
      <View style={[s.divider, { backgroundColor: c.border }]} />
      <NavRow icon="clock" title="Focus" onPress={() => router.push("/focus")} />
      <NavRow icon="settings" title="Settings" onPress={() => router.push("/settings")} />
      <NavRow icon="gift" title="What's new" onPress={() => router.push("/whats-new")} />
      <NavRow icon="alert-circle" title="Report a problem" onPress={() => router.push("/report")} />
      <NavRow icon={account ? "user-check" : "user"} title={account ? "Account" : "Sign in to sync"} sub={account ? statusText(status) : "Optional. Share tasks with your computer."} onPress={() => router.push("/account")} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: INSET, marginBottom: 8, paddingHorizontal: 12, height: 44, borderRadius: 10 },
  listsHead: { flexDirection: "row", alignItems: "flex-end", paddingRight: 8 },
  folder: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 48, paddingRight: GUTTER },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: GUTTER, marginVertical: 12 },
});
