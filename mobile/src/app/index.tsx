import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { todayLocal } from "@core/domain/dates";
import { inSmartList, toVM, type TaskVM } from "@core/domain/taskViews";
import { setStatus, useData } from "@core/stores/data";
import { createFromText } from "@core/stores/quickAddSubmit";
import { ready } from "@/boot";
import { useColors, type Colors } from "@/theme";

type Row = { kind: "header"; title: string } | { kind: "task"; vm: TaskVM; section: string };

/** C3: Today and Inbox from the shared stores, saved in the phone's own SQLite. Plain on purpose; designed later. */
export default function Index() {
  const c = useColors();
  const [loaded, setLoaded] = useState<"loading" | "ok" | Error>("loading");
  const [text, setText] = useState("");
  const tasks = useData((s) => s.tasks);

  useEffect(() => {
    ready.then(() => setLoaded("ok"), (e: unknown) => setLoaded(e instanceof Error ? e : new Error(String(e))));
  }, []);

  const rows = useMemo<Row[]>(() => {
    const today = todayLocal();
    const vms = Object.values(tasks).flatMap((t) => toVM(t) ?? []);
    const section = (title: string, id: "today" | "inbox") => {
      const hits = vms.filter((vm) => inSmartList(id, vm, today));
      return hits.length ? [{ kind: "header" as const, title }, ...hits.map((vm) => ({ kind: "task" as const, vm, section: id }))] : [];
    };
    return [...section("Today", "today"), ...section("Inbox", "inbox")];
  }, [tasks]);

  if (loaded === "loading") return <ActivityIndicator style={styles.center} color={c.accent} />;
  if (loaded instanceof Error) return <Text style={[styles.center, { color: c.fg }]}>Couldn't open the database: {loaded.message}</Text>;

  const add = () => {
    if (createFromText(text, {}, true, () => false)) setText("");
  };

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => (r.kind === "header" ? r.title : `${r.section}:${r.vm.task.id}`)}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.page}
      ListHeaderComponent={
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={add}
          submitBehavior="submit"
          returnKeyType="done"
          placeholder="Add a task: Call mum tomorrow 5pm !high"
          placeholderTextColor={c.muted}
          style={[styles.input, { color: c.fg, backgroundColor: c.surface, borderColor: c.border }]}
        />
      }
      ListEmptyComponent={<Text style={{ color: c.muted }}>Nothing for today. Add something above.</Text>}
      renderItem={({ item }) => (item.kind === "header" ? <Text style={[styles.header, { color: c.muted }]}>{item.title}</Text> : <TaskRow vm={item.vm} c={c} />)}
    />
  );
}

function TaskRow({ vm, c }: { vm: TaskVM; c: Colors }) {
  const t = vm.task;
  const done = t.status !== "open";
  const s = t.schedule;
  const when = s.kind === "none" ? "" : s.kind === "day" ? s.date : new Date(s.start).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  return (
    <Pressable onPress={() => setStatus(t.id, done ? "open" : "done")} style={[styles.row, { borderColor: c.border }]} accessibilityRole="checkbox" accessibilityState={{ checked: done }}>
      <View style={[styles.check, { borderColor: done ? c.accent : c.muted, backgroundColor: done ? c.accent : "transparent" }]} />
      <View style={styles.rowText}>
        <Text style={[styles.title, { color: done ? c.muted : c.fg, textDecorationLine: done ? "line-through" : "none" }]}>{t.title}</Text>
        {when ? <Text style={[styles.meta, { color: c.muted }]}>{when}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, padding: 16 },
  page: { padding: 16, gap: 4 },
  input: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, height: 48, fontSize: 16, marginBottom: 8 },
  header: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", marginTop: 16, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
  rowText: { flex: 1, paddingVertical: 8 },
  title: { fontSize: 16 },
  meta: { fontSize: 13, marginTop: 2 },
});
