import { router, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { newsGroups } from "@core/domain/changelog";
import { useColors } from "@/theme";
import { appVersion, sectionsSince } from "@/whatsNew";
import { Button, Label, Text } from "@/ui/kit";

/** What changed: the CHANGELOG sections since `since` (after an update), or this version's. Markdown shows as plain text. */
export default function WhatsNew() {
  const c = useColors();
  const { since } = useLocalSearchParams<{ since?: string }>();
  const notes = useMemo(() => sectionsSince(since ?? null), [since]);
  const many = notes.length > 1;
  return (
    <ScrollView contentContainerStyle={st.page}>
      <Text style={[st.title, { color: c.fg }]}>Momentum {appVersion}</Text>
      {notes.length === 0 ? <Text style={{ color: c.muted }}>Nothing to show yet.</Text> : null}
      {notes.map((s) => (
        <View key={s.version}>
          {many ? <Label>v{s.version}</Label> : null}
          {newsGroups(s.body).map((g, n) => (
            <View key={n} style={st.group}>
              {g.heading ? <Text style={[st.heading, { color: c.muted }]}>{g.heading}</Text> : null}
              {g.items.map((i, m) => (
                <View key={m} style={st.item}>
                  <Text style={{ color: c.fg2 }}>•</Text>
                  <Text style={[st.text, { color: c.fg2 }]}>{i.text.replace(/\*\*|`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      ))}
      <Button label="Close" kind="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
    </ScrollView>
  );
}

const st = StyleSheet.create({
  page: { padding: 16, gap: 8 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
  group: { gap: 6, marginBottom: 8 },
  heading: { fontSize: 13, fontWeight: "600" },
  item: { flexDirection: "row", gap: 8 },
  text: { flex: 1, fontSize: 15, lineHeight: 21 },
});
