import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, Share, StyleSheet, View } from "react-native";
import { hhmm } from "@core/domain/dates";
import { useSync } from "@core/lib/sync/engine";
import * as api from "@core/lib/sync/social";
import { toast } from "@core/stores/toast";
import { GUTTER, useColors } from "@/theme";
import { Button, Label, NavRow, Text } from "@/ui/kit";
import { pickDate } from "@/ui/pickDate";
import { choose } from "@/ui/Sheet";
import { run } from "@/social/actions";

const CODE_MS = 10 * 60_000;
const SOURCE = { discord: "Discord", slack: "Slack", telegram: "Telegram" } as const;
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;

/** Settings → Connections (v1.4, D263): link a chat with a one-time code, set each chat's Digest, and the webhook. */
export default function Connections() {
  const c = useColors();
  const account = useSync((s) => s.account);
  const [chats, setChats] = useState<api.Connection[]>([]);
  const [webhook, setWebhook] = useState<boolean | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [access, setAccess] = useState<api.Permission | null>(null);
  const [code, setCode] = useState<{ value: string; until: number } | null>(null);
  const [now, setNow] = useState(Date.now());

  const reload = useCallback(async () => {
    const [list, has, perm] = await Promise.all([run(api.myConnections), run(api.hasWebhook), run(api.webhookPermission)]);
    if (list) setChats(list);
    if (perm !== undefined) setAccess(perm);
    if (has !== undefined) setWebhook(has);
  }, []);
  useEffect(() => void (account && reload()), [account, reload]);
  // While a code is showing: count down, and look for the new chat every few seconds.
  useEffect(() => {
    if (!code) return;
    const i = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= code.until) setCode(null);
    }, 1000);
    const poll = setInterval(() => void reload(), 5000);
    return () => (clearInterval(i), clearInterval(poll));
  }, [code, reload]);

  if (!account)
    return (
      <View style={{ padding: GUTTER }}>
        <Text variant="secondary" style={{ color: c.fg2 }}>
          Sign in under Account to connect Discord, Slack or Telegram.
        </Text>
      </View>
    );

  const link = async () => {
    const value = await run(api.createLinkCode);
    if (value) {
      setNow(Date.now());
      setCode({ value, until: Date.now() + CODE_MS });
    }
  };
  const chat = async (x: api.Connection) => {
    const a = await choose(`${SOURCE[x.source]}${x.label ? ` · ${x.label}` : ""}`, [
      { value: "access", label: x.permission === "full" ? "Make add-only" : "Allow full access", icon: "lock" },
      ...(x.permission === "full" ? [{ value: "time", label: x.digestTime ? "Change Digest time" : "Turn on Digest", icon: "sun" } as const] : []),
      ...(x.permission === "full" && x.digestTime ? [{ value: "off", label: "Turn off Digest", icon: "bell-off" } as const] : []),
      { value: "remove", label: "Remove", icon: "trash-2", danger: true },
    ]);
    if (a === "access") {
      if (await run(() => api.setConnectionPermission(x.id, x.permission === "full" ? "add" : "full").then(() => true))) void reload();
    } else if (a === "time") {
      const [h, m] = (x.digestTime ?? "08:00").split(":").map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      const picked = await pickDate("time", d);
      if (picked && (await run(() => api.setDigest(x.id, hhmm(picked)).then(() => true)))) void reload();
    } else if (a === "off") {
      if (await run(() => api.setDigest(x.id, null).then(() => true))) void reload();
    } else if (a === "remove")
      Alert.alert("Remove this chat?", "It stops adding tasks and sending the Digest. You can link it again.", [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => void run(() => api.removeConnection(x.id)).then(reload) },
      ]);
  };
  const makeWebhook = async () => {
    if (webhook && !(await new Promise<boolean>((ok) => Alert.alert("Regenerate the webhook?", "The old secret stops working.", [{ text: "Cancel", style: "cancel", onPress: () => ok(false) }, { text: "Regenerate", style: "destructive", onPress: () => ok(true) }], { onDismiss: () => ok(false) })))) return;
    const s = await run(api.createWebhook);
    if (s) {
      setSecret(s);
      setWebhook(true);
    }
  };
  const left = code ? Math.max(0, code.until - now) : 0;
  const mono = { color: c.fg } as const; // the UI font, selectable: the timer font is for the timer only (DES-11)

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      <Label inset>Link a chat</Label>
      <View style={st.block}>
        {code ? (
          <>
            <Text variant="display" accessibilityLabel={`Code ${code.value.split("").join(" ")}`} style={{ fontVariant: ["tabular-nums"], letterSpacing: 4 }}>
              {code.value}
            </Text>
            <Text variant="meta" style={{ color: c.muted }}>{`Expires in ${clock(left)}. Send it from the chat you want to link:`}</Text>
            <Text selectable style={mono}>{`Discord: /task link ${code.value}`}</Text>
            <Text selectable style={mono}>{`Slack: /momentum link ${code.value}`}</Text>
            <Text selectable style={mono}>{`Telegram: link ${code.value}`}</Text>
          </>
        ) : (
          <Text variant="secondary" style={{ color: c.fg2 }}>
            Get a one-time code, then send it to the Momentum bot in Discord, Slack or Telegram. Tasks you send from there land in your Inbox.
          </Text>
        )}
        <Button label={code ? "New code" : "Get a code"} icon="link" kind={code ? "secondary" : "primary"} onPress={link} />
      </View>

      <Label inset>Linked chats</Label>
      {chats.map((x) => (
        <NavRow key={x.id} icon="message-circle" title={`${SOURCE[x.source]}${x.label ? ` · ${x.label}` : ""}`} sub={`${x.permission === "full" ? "Full access" : "Add only"} · ${x.digestTime ? `Digest at ${x.digestTime}` : "Digest off"}`} chevron="more-horizontal" onPress={() => void chat(x)} />
      ))}
      {chats.length ? null : (
        <Text variant="meta" style={{ color: c.muted, paddingHorizontal: GUTTER }}>
          No chats linked yet.
        </Text>
      )}

      <Label inset>Webhook</Label>
      <View style={st.block}>
        <Text variant="secondary" style={{ color: c.fg2 }}>
          A private address that adds a task to your Inbox from any service: POST {"{ \"text\": \"…\" }"} with the secret in the X-Webhook-Secret header. Anyone with the secret can add tasks, so keep it private.
        </Text>
        {webhook ? (
          <Text selectable variant="meta" style={{ color: c.fg }}>
            {`POST ${api.webhookEndpoint()}`}
          </Text>
        ) : null}
        {secret ? (
          <>
            <Text selectable variant="meta" style={{ color: c.fg }}>
              {`X-Webhook-Secret: ${secret}`}
            </Text>
            <Text variant="meta" style={{ color: c.muted }}>
              This is the only time the secret is shown. Press and hold it to copy, or share it.
            </Text>
            <Button label="Copy or share" icon="share" kind="secondary" onPress={() => void Share.share({ message: `${api.webhookEndpoint()}\nX-Webhook-Secret: ${secret}` })} />
          </>
        ) : null}
        {webhook ? (
          <Text selectable variant="meta" style={{ color: c.fg2 }}>
            {`Example:\ncurl -X POST ${api.webhookEndpoint()} \\\n  -H "X-Webhook-Secret: ${secret ?? "<your secret>"}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"text":"Buy milk tomorrow"}'`}
          </Text>
        ) : null}
        {webhook === null ? null : webhook ? (
          <>
            {secret ? null : <Text variant="meta" style={{ color: c.muted }}>The webhook is on. Regenerate it to see a new secret; the old one stops working.</Text>}
            {access ? (
              <Button
                label={access === "full" ? "Access: full (tap for add-only)" : "Access: add only (tap for full)"}
                icon="lock"
                kind="outline"
                onPress={() => void run(() => api.setWebhookPermission(access === "full" ? "add" : "full").then(() => true)).then((ok) => ok && setAccess(access === "full" ? "add" : "full"))}
              />
            ) : null}
            <Button label="Regenerate" icon="refresh-cw" kind="outline" onPress={makeWebhook} />
            <Button
              label="Delete webhook"
              icon="trash-2"
              kind="outline"
              onPress={() =>
                Alert.alert("Delete the webhook?", "Anything posting to it stops working.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: () => void run(api.deleteWebhook).then(() => (setSecret(null), setWebhook(false), toast("Webhook deleted."))) },
                ])
              }
            />
          </>
        ) : (
          <Button label="Create webhook" icon="plus" onPress={makeWebhook} />
        )}
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({ block: { paddingHorizontal: GUTTER, gap: 10, paddingBottom: 8 } });
