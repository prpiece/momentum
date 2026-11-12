import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { derive } from "@core/domain/taskViews";
import { INBOX_ID } from "@core/domain/types";
import { useData } from "@core/stores/data";
import { FONTS, INSET, resolveColor, useColors } from "@/theme";
import { Empty, Icon, IconButton, NavRow } from "@/ui/kit";
import { TaskRow } from "@/ui/TaskRow";

/** Tasks whose title or notes contain every typed word (open ones first), and lists by name. */
export default function Search() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const tasks = useData((s) => s.tasks);
  const lists = useData((s) => s.lists);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const hits = useMemo(
    () =>
      words.length
        ? derive(tasks, lists)
            .active.filter((vm) => matches(`${vm.task.title}\n${vm.task.description}`))
            .sort((a, b) => Number(a.task.status !== "open") - Number(b.task.status !== "open"))
            .slice(0, 100)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, tasks, lists],
  );
  const listHits = words.length ? Object.values(lists).filter((l) => !l.archived && matches(l.name)) : [];
  return (
    <View style={{ flex: 1, paddingTop: insets.top + 4 }}>
      <View style={s.bar}>
        <IconButton icon="chevron-left" label="Back" color={c.accentText} onPress={() => router.back()} />
        <View style={[s.field, { backgroundColor: c.surface2 }]}>
          <Icon name="search" color={c.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search tasks and lists" placeholderTextColor={c.muted} autoFocus autoCapitalize="none" returnKeyType="search" maxFontSizeMultiplier={2} style={[s.input, { color: c.fg }]} accessibilityLabel="Search" />
        </View>
      </View>
      <FlatList
        data={hits}
        keyExtractor={(vm) => `${vm.task.id}${vm.key ?? ""}`}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={<>{listHits.map((l) => <NavRow key={l.id} icon={l.id === INBOX_ID ? "inbox" : undefined} dot={resolveColor(c, l.color, c.muted)} title={l.name} onPress={() => router.push({ pathname: "/browse/list/[id]", params: { id: l.id } })} />)}</>}
        ListEmptyComponent={words.length && !listHits.length ? <Empty text="No matches" hint="Search looks in task titles, notes and list names." /> : undefined}
        renderItem={({ item }) => <TaskRow vm={item} />}
      />
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", paddingLeft: 4, paddingRight: INSET, paddingBottom: 8 },
  field: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, height: 44, borderRadius: 10 },
  input: { flex: 1, fontSize: 16, fontFamily: FONTS[400], padding: 0 },
});
