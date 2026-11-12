import Constants from "expo-constants";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, View } from "react-native";
import { reportProblem, sendReport, type Screenshot } from "@core/lib/sync/report";
import { supabase, syncConfigured } from "@core/lib/sync/supabase";
import { toast } from "@core/stores/toast";
import { useColors } from "@/theme";
import { Button, Field, Label, Text } from "@/ui/kit";

/** Same form as the desktop's Settings → Help → Report a problem: name, email, description, optional screenshot. */
export default function Report() {
  const c = useColors();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [shot, setShot] = useState<Screenshot | null>(null);
  const [state, setState] = useState<"form" | "sending" | "sent">("form");

  useEffect(() => {
    if (syncConfigured) void supabase.auth.getSession().then(({ data }) => setEmail((e) => e || data.session?.user.email || ""));
  }, []);

  const report = () => ({ name, email, body, appVersion: Constants.expoConfig?.version ?? "unknown", platform: Platform.OS, screenshot: shot });
  const invalid = reportProblem(report());

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    const a = r.canceled ? null : r.assets[0];
    if (!a) return;
    const next: Screenshot = { name: a.fileName ?? "screenshot", type: a.mimeType ?? "image/jpeg", bytes: await (await fetch(a.uri)).arrayBuffer() };
    const err = reportProblem({ ...report(), screenshot: next });
    if (err && /screenshot/.test(err)) return toast(err);
    setShot(next);
  };

  const send = async () => {
    setState("sending");
    const error = await sendReport(report());
    if (error) {
      setState("form");
      return toast(error);
    }
    setState("sent");
  };

  if (state === "sent")
    return (
      <View style={st.page}>
        <Text style={{ color: c.fg, fontSize: 18, fontWeight: "600" }}>Report sent</Text>
        <Text style={{ color: c.fg2, fontSize: 16 }}>Thanks. We'll reply to {email.trim()} if we need more detail.</Text>
        <Button label="Close" onPress={() => router.back()} />
      </View>
    );
  return (
    <ScrollView contentContainerStyle={st.page} keyboardShouldPersistTaps="handled">
      <Label>Name (optional)</Label>
      <Field value={name} onChangeText={setName} maxLength={100} autoComplete="name" />
      <Label>Email, so we can reply</Label>
      <Field value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <Label>What happened? What did you expect?</Label>
      <Field value={body} onChangeText={setBody} multiline maxLength={5000} style={{ minHeight: 140, textAlignVertical: "top" }} />
      <View style={{ gap: 8, marginTop: 12 }}>
        <Button label={shot ? "Replace screenshot" : "Add a screenshot"} kind="secondary" icon="image" onPress={pick} />
        {shot ? <Button label={`Remove ${shot.name}`} kind="secondary" onPress={() => setShot(null)} /> : null}
        <Text style={{ color: c.muted, fontSize: 13 }}>Sent with your app version and system. Needs an internet connection.</Text>
        {state === "sending" ? <ActivityIndicator color={c.accent} /> : null}
        <Button label={state === "sending" ? "Sending…" : "Send report"} onPress={send} disabled={!!invalid || state === "sending"} />
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({ page: { padding: 16, gap: 8 } });
