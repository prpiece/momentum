import { useEffect, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { deleteAccount, keepAccount, loadAccount, saveHandle, sendCode, statusText, verifyCode, type AccountInfo } from "@core/lib/sync/account";
import { signOut, syncNow, useSync } from "@core/lib/sync/engine";
import { syncConfigured } from "@core/lib/sync/supabase";
import { toast } from "@core/stores/toast";
import { useColors, type Colors } from "@/theme";

const SITE = "https://prpiece.github.io/momentum/";

/** C4: sign in with an email code, choose a handle, see sync status and devices. Plain; designed later. */
export default function Account() {
  const c = useColors();
  const account = useSync((s) => s.account);
  if (!syncConfigured) return <Text style={[styles.page, { color: c.fg }]}>Sync isn't set up in this build.</Text>;
  return <ScrollView contentContainerStyle={styles.page}>{account ? <SignedIn account={account} c={c} /> : <SignIn c={c} />}</ScrollView>;
}

/** Resolves true for the first button, false for the second. */
const ask = (title: string, body: string, yes: string, no: string) =>
  new Promise<boolean>((resolve) => Alert.alert(title, body, [{ text: no, onPress: () => resolve(false), style: "cancel" }, { text: yes, onPress: () => resolve(true) }], { cancelable: false }));

function SignIn({ c }: { c: Colors }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const canSend = agreed && email.includes("@") && !busy;
  const canVerify = /^\d{6}$/.test(code.trim()) && !busy;

  const send = async () => {
    setBusy(true);
    const error = await sendCode(email);
    setBusy(false);
    if (error) return toast(error);
    setSent(true);
  };
  const verify = async () => {
    setBusy(true);
    const { message } = await verifyCode(email, code, () =>
      ask("Add this phone's data to your account?", "The data here belongs to another account. Add it to the account you're signing in to, or remove it from this phone (a backup is kept).", "Add it", "Remove it"),
    );
    setBusy(false);
    toast(message);
  };

  return (
    <View style={styles.stack}>
      <Text style={[styles.body, { color: c.fg2 }]}>Sign in to keep your tasks, habits and settings in step with your computer. Without an account, Momentum works offline on this phone.</Text>
      {!sent ? (
        <>
          <Field c={c} value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" onSubmitEditing={() => canSend && void send()} />
          <View style={styles.consent}>
            <Switch value={agreed} onValueChange={setAgreed} accessibilityLabel="I'm 13 or older and accept the Terms and Privacy policy" />
            <Text style={[styles.small, { color: c.fg2, flex: 1 }]}>
              I'm 13 or older and I accept the{" "}
              <Text style={{ color: c.accent }} onPress={() => void Linking.openURL(`${SITE}terms.html`)}>
                Terms
              </Text>{" "}
              and the{" "}
              <Text style={{ color: c.accent }} onPress={() => void Linking.openURL(`${SITE}privacy.html`)}>
                Privacy policy
              </Text>
              .
            </Text>
          </View>
          <Button c={c} label="Email me a code" onPress={send} disabled={!canSend} />
        </>
      ) : (
        <>
          <Text style={[styles.small, { color: c.fg2 }]}>We sent a 6-digit code to {email.trim()}.</Text>
          <Field c={c} value={code} onChangeText={setCode} placeholder="123456" keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" onSubmitEditing={() => canVerify && void verify()} />
          <Button c={c} label="Sign in" onPress={verify} disabled={!canVerify} />
          <Button c={c} label="Use another email" onPress={() => setSent(false)} secondary />
        </>
      )}
    </View>
  );
}

function SignedIn({ account, c }: { account: string; c: Colors }) {
  const status = useSync((s) => s.status);
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    let live = true;
    void loadAccount(account).then((a) => live && setInfo(a));
    return () => void (live = false);
  }, [account, status.kind]);

  const save = async () => {
    const res = await saveHandle(account, handle, name);
    if (!res.ok) return toast(res.message);
    setInfo((i) => i && { ...i, profile: res.profile });
  };
  const leave = async () => {
    const keep = await ask("Sign out", "Keep a copy of your data on this phone, or remove it? Your account keeps everything either way.", "Keep a copy", "Remove it");
    await signOut(keep ? "keep" : "remove");
    toast(keep ? "Signed out. Your data stays on this phone." : "Signed out and removed this phone's data. A backup was kept.");
  };

  const remove = async () => {
    const yes = await ask(
      "Delete your account?",
      "Every device is signed out, and in 7 days your account and everything synced to it are deleted for good. Signing in before then lets you keep it. This phone keeps its own copy of your data.",
      "Delete account",
      "Cancel",
    );
    if (!yes) return;
    const res = await deleteAccount();
    toast(res.message);
  };
  const keep = async () => {
    const err = await keepAccount(account);
    if (err) return toast(err);
    setInfo((i) => i && { ...i, deletesAt: null });
    toast("Your account won't be deleted.");
  };

  return (
    <View style={styles.stack}>
      {info?.deletesAt ? (
        <View style={[styles.banner, { backgroundColor: c.surface2 }]}>
          <Text style={[styles.body, { color: c.fg }]}>
            This account will be deleted on {info.deletesAt.toLocaleDateString([], { day: "numeric", month: "long" })}, with everything synced to it.
          </Text>
          <Button c={c} label="Keep my account" onPress={keep} />
        </View>
      ) : null}
      {info && !info.profile.handle ? (
        <>
          <Text style={[styles.heading, { color: c.fg }]}>Choose your handle</Text>
          <Text style={[styles.small, { color: c.fg2 }]}>Friends will find you by it later. You can change it once every 30 days.</Text>
          <View style={[styles.field, styles.handle, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={{ color: c.muted, fontSize: 16 }}>@</Text>
            <TextInput value={handle} onChangeText={(t) => setHandle(t.replace(/^\s*@+/, ""))} placeholder="handle" placeholderTextColor={c.muted} autoCapitalize="none" autoCorrect={false} style={[styles.handleInput, { color: c.fg }]} />
          </View>
          <Field c={c} value={name} onChangeText={setName} placeholder="Display name" />
          <Button c={c} label="Save" onPress={save} />
        </>
      ) : (
        <View>
          <Text style={[styles.heading, { color: c.fg }]}>{info?.profile.display_name ?? "…"}</Text>
          <Text style={[styles.small, { color: c.fg2 }]}>
            {info?.profile.handle ? `@${info.profile.handle} · ` : ""}
            {info?.email}
          </Text>
        </View>
      )}
      <Text style={[styles.body, { color: c.fg2 }]}>{statusText(status)}</Text>
      <Button c={c} label="Sync now" onPress={() => void syncNow()} secondary />
      <Text style={[styles.label, { color: c.muted }]}>Signed-in devices</Text>
      {info?.devices.map((d) => (
        <Text key={d.id} style={[styles.body, { color: c.fg }]}>
          {d.platform ?? "Device"}
          {d.id === info.me ? " (this phone)" : ` · last synced ${new Date(d.last_seen).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`}
        </Text>
      ))}
      <Button c={c} label="Sign out" onPress={leave} secondary />
      {info && !info.deletesAt ? (
        <Pressable onPress={() => void remove()} accessibilityRole="button" style={styles.danger}>
          <Text style={{ color: c.danger, fontSize: 16, fontWeight: "600" }}>Delete account</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Field({ c, ...props }: { c: Colors } & React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={c.muted} autoCapitalize="none" autoCorrect={false} style={[styles.field, { color: c.fg, backgroundColor: c.surface, borderColor: c.border }]} {...props} />;
}

function Button({ c, label, onPress, disabled, secondary }: { c: Colors; label: string; onPress: () => unknown; disabled?: boolean; secondary?: boolean }) {
  return (
    <Pressable
      onPress={() => void onPress()}
      disabled={disabled}
      accessibilityRole="button"
      style={[styles.button, secondary ? { backgroundColor: c.surface2 } : { backgroundColor: c.accent }, disabled && { opacity: 0.5 }]}
    >
      <Text style={{ color: secondary ? c.fg : c.accentFg, fontSize: 16, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16 },
  stack: { gap: 12 },
  banner: { borderRadius: 10, padding: 12, gap: 12 },
  danger: { minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 12 },
  heading: { fontSize: 18, fontWeight: "600" },
  body: { fontSize: 15 },
  small: { fontSize: 13 },
  label: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", marginTop: 8 },
  consent: { flexDirection: "row", alignItems: "center", gap: 8 },
  field: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, height: 48, fontSize: 16 },
  handle: { flexDirection: "row", alignItems: "center", gap: 2 },
  handleInput: { flex: 1, fontSize: 16, height: "100%" },
  button: { height: 48, borderRadius: 6, alignItems: "center", justifyContent: "center" },
});
