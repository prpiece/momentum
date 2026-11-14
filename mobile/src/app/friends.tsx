import { router } from "expo-router";
import { useMemo, type ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSync } from "@core/lib/sync/engine";
import { respondFriend, respondSentTask, respondShare, nudge } from "@core/lib/sync/social";
import { act, requestCount, useSocial } from "@core/stores/social";
import { toast } from "@core/stores/toast";
import { GUTTER, useColors } from "@/theme";
import { Button, Empty, IconButton, Label, NavRow, PageHeader, Text } from "@/ui/kit";
import { addFriend, friendMenu, nameOf, openLink, run, shareFriendLink } from "@/social/actions";
import { askText } from "@/ui/Sheet";

/** Friends (v1.4): friends, Requests with a badge, Add friend, invite links and your check-in buddies' habits. */
export default function Friends() {
  const c = useColors();
  const account = useSync((s) => s.account);
  const friends = useSocial((s) => s.friends);
  const incomingTasks = useSocial((s) => s.incomingTasks);
  const outgoingTasks = useSocial((s) => s.outgoingTasks);
  const shares = useSocial((s) => s.shares);
  const buddyHabits = useSocial((s) => s.buddyHabits);
  const requests = useSocial(requestCount);
  const { accepted, asking, asked } = useMemo(
    () => ({
      accepted: friends.filter((f) => f.status === "accepted"),
      asking: friends.filter((f) => f.status === "pending" && f.incoming),
      asked: friends.filter((f) => f.status === "pending" && !f.incoming),
    }),
    [friends],
  );
  const invited = useMemo(() => shares.filter((x) => x.status === "invited"), [shares]);
  const recentlySent = useMemo(() => outgoingTasks.filter((t) => t.status !== "pending").slice(0, 5), [outgoingTasks]);

  const head = <PageHeader title="Friends" back={{ label: "Browse", onPress: () => router.back() }} actions={account ? <IconButton icon="user-plus" label="Add friend" onPress={() => void addFriend()} /> : null} />;
  if (!account)
    return (
      <View style={{ flex: 1 }}>
        {head}
        <Text variant="secondary" style={{ color: c.fg2, paddingHorizontal: GUTTER }}>
          Sign in under Account to add friends, send tasks and share lists.
        </Text>
        <NavRow icon="user" title="Account" onPress={() => router.push("/account")} />
        <NavRow icon="link" title="Open invite link" sub="Kept until you sign in" onPress={() => void openPasted()} />
      </View>
    );

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      {head}
      {requests ? <Label inset>{`Requests (${requests})`}</Label> : null}
      {asking.map((f) => (
        <Item key={f.id} title={nameOf(f)} sub="Wants to be friends">
          <Answer onAccept={() => void run(() => act(() => respondFriend(f.id, true)))} onDecline={() => void run(() => act(() => respondFriend(f.id, false)))} />
        </Item>
      ))}
      {incomingTasks.map((t) => (
        <Item key={t.id} title={t.payload.title} sub={`Task from ${nameOf(t.sender)}`}>
          <Answer
            onAccept={() => void run(() => act(() => respondSentTask(t.id, true), true)).then((r) => r !== undefined && toast("Added to your Inbox."))}
            onDecline={() => void run(() => act(() => respondSentTask(t.id, false)))}
          />
        </Item>
      ))}
      {invited.map((x) => (
        <Item key={x.shareId} title={x.name ?? (x.kind === "list" ? "A shared list" : "A shared folder")} sub={`Invitation to ${x.role === "viewer" ? "view" : "edit"}`}>
          <Answer onAccept={() => void run(() => act(() => respondShare(x.shareId, true), true))} onDecline={() => void run(() => act(() => respondShare(x.shareId, false), true))} />
        </Item>
      ))}
      {recentlySent.map((t) => (
        <Item key={t.id} title={t.title} sub={`${t.status === "accepted" ? "Accepted" : "Declined"} by ${t.handle ? `@${t.handle}` : "a friend"}`} />
      ))}

      <Label inset>Friends</Label>
      {accepted.map((f) => (
        <NavRow key={f.id} icon="user" title={nameOf(f)} sub={f.displayName ? `@${f.handle}` : undefined} chevron="more-horizontal" onPress={() => void friendMenu(f)} />
      ))}
      {asked.map((f) => (
        <Item key={f.id} title={nameOf(f)} sub="Request sent" />
      ))}
      {accepted.length || asked.length ? null : <Empty text="No friends yet" hint="Add one by @handle or send them an invite link." />}
      <NavRow icon="user-plus" title="Add friend" sub="By @handle" onPress={() => void addFriend()} />
      <NavRow icon="share" title="Share invite link" sub="Lasts 30 days" onPress={() => void shareFriendLink()} />
      <NavRow icon="link" title="Open invite link" sub="Paste one you were sent" onPress={() => void openPasted()} />

      {buddyHabits.length ? <Label inset>Buddies' habits</Label> : null}
      {buddyHabits.map((b) => (
        <Item key={`${b.owner.id}${b.habitId}`} title={b.name} sub={`${nameOf(b.owner)} · ${b.today > 0 ? "checked in today" : "not yet today"}`}>
          <Button label="Nudge" icon="bell" kind="secondary" disabled={!b.canNudge} onPress={() => void run(() => act(() => nudge(b.owner.id, b.habitId))).then(() => toast(`Nudged ${nameOf(b.owner)}.`))} style={s.small} />
        </Item>
      ))}
    </ScrollView>
  );
}

async function openPasted() {
  // Signed out, the code is kept for after sign-in (D261).
  const text = await askText("Open invite link", { placeholder: "Paste the link or code", confirm: "Open" });
  if (text) await openLink(text);
}

/** A row with a title, a sub-line and (optionally) buttons on the right. */
function Item({ title, sub, children }: { title: string; sub: string; children?: ReactNode }) {
  const c = useColors();
  return (
    <View style={[s.item, { borderColor: c.border }]}>
      <View style={{ flex: 1 }}>
        <Text variant="body" numberOfLines={2}>
          {title}
        </Text>
        <Text variant="meta" style={{ color: c.muted }}>
          {sub}
        </Text>
      </View>
      {children}
    </View>
  );
}

function Answer({ onAccept, onDecline }: { onAccept: () => void; onDecline: () => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Button label="Decline" kind="outline" onPress={onDecline} style={s.small} />
      <Button label="Accept" onPress={onAccept} style={s.small} />
    </View>
  );
}

const s = StyleSheet.create({
  item: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: GUTTER, paddingVertical: 8 },
  small: { minHeight: 44, paddingHorizontal: 12 },
});
