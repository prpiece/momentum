import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, Share as NativeShare, View } from "react-native";
import { inviteUrl } from "@core/domain/invite";
import { useSync } from "@core/lib/sync/engine";
import * as api from "@core/lib/sync/social";
import { useData } from "@core/stores/data";
import { act, useSocial } from "@core/stores/social";
import { toast } from "@core/stores/toast";
import { GUTTER, useColors } from "@/theme";
import { Button, Label, NavRow, PageHeader, Text } from "@/ui/kit";
import { choose } from "@/ui/Sheet";
import { nameOf, pickFriend, run } from "@/social/actions";

const ROLE = { owner: "Owner", editor: "Can edit", viewer: "Can view" } as const;

/** Sharing a list or folder (v1.4, D262): members and roles, invite a friend, a link with a role, leave, stop sharing, transfer. */
export default function ShareScreen() {
  const c = useColors();
  const { kind: rawKind, id } = useLocalSearchParams<{ kind?: string; id: string }>();
  const kind: api.ShareKind = rawKind === "folder" ? "folder" : "list"; // a deep link can carry anything
  const me = useSync((s) => s.account);
  const shares = useSocial((s) => s.shares);
  const lists = useData((s) => s.lists);
  const folders = useData((s) => s.folders);
  const share = useMemo(() => shares.find((x) => x.kind === kind && x.containerId === id && x.status === "active"), [shares, kind, id]);
  const name = (kind === "folder" ? folders[id]?.name : lists[id]?.name) ?? "Shared";
  const [members, setMembers] = useState<api.Member[]>([]);
  const shareId = share?.shareId;
  const reload = useCallback(async () => {
    if (shareId) setMembers((await run(() => api.shareMembers(shareId))) ?? []);
  }, [shareId]);
  useEffect(() => void reload(), [reload]);

  const owner = share?.role === "owner";
  const back = { label: name, onPress: () => router.back() };
  if (!me)
    return (
      <View style={{ flex: 1 }}>
        <PageHeader title="Share" back={back} />
        <Text variant="secondary" style={{ color: c.fg2, paddingHorizontal: GUTTER }}>
          Sign in under Account to share.
        </Text>
      </View>
    );
  if (!share)
    return (
      <View style={{ flex: 1 }}>
        <PageHeader title="Share" back={back} />
        <Text variant="secondary" style={{ color: c.fg2, paddingHorizontal: GUTTER, paddingBottom: 16 }}>
          {`Share “${name}” with friends. Members see the same tasks and sync them; each keeps their own reminders and tags.`}
        </Text>
        <View style={{ paddingHorizontal: GUTTER }}>
          <Button label={`Share this ${kind}`} icon="users" onPress={() => void run(() => act(() => api.createShare(kind, id), true))} />
        </View>
      </View>
    );

  const leave = () =>
    Alert.alert(`Leave “${name}”?`, "Its tasks leave your phone on the next sync.", [
      { text: "Cancel", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: async () => (await run(() => act(() => api.removeMember(share.shareId, me), true)) !== undefined) && router.back() },
    ]);
  const stop = () =>
    Alert.alert(`Stop sharing “${name}”?`, "Everyone else loses access. Your tasks stay.", [
      { text: "Cancel", style: "cancel" },
      { text: "Stop sharing", style: "destructive", onPress: async () => (await run(() => act(() => api.deleteShare(share.shareId), true)) !== undefined) && router.back() },
    ]);
  const chooseRole = (title: string) =>
    choose<"editor" | "viewer">(title, [
      { value: "editor", label: "Can edit", icon: "edit-2" },
      { value: "viewer", label: "Can view", icon: "eye" },
    ]);
  const invite = async () => {
    const f = await pickFriend("Invite", members.map((m) => m.id));
    const role = f && (await chooseRole(`${nameOf(f)} can…`));
    if (f && role && (await run(() => api.inviteToShare(share.shareId, f.id, role).then(() => true)))) {
      toast(`Invited ${nameOf(f)}.`);
      void reload();
    }
  };
  const link = async () => {
    const role = await chooseRole("People with the link can…");
    const code = role && (await run(() => api.createShareInvite(share.shareId, role)));
    if (code) await NativeShare.share({ message: `Join “${name}” on Momentum: ${inviteUrl(code)}` });
  };
  const member = async (m: api.Member) => {
    if (!owner || m.id === me) return;
    const a = await choose(nameOf(m), [
      ...(m.status === "active" ? [{ value: m.role === "editor" ? "viewer" : "editor", label: m.role === "editor" ? "Make viewer" : "Make editor", icon: "edit-2" as const }] : []),
      ...(m.status === "active" ? [{ value: "transfer", label: "Make owner", detail: "You become an editor", icon: "key" as const }] : []),
      { value: "remove", label: m.status === "active" ? "Remove" : "Cancel invitation", icon: "user-minus" as const, danger: true },
    ]);
    if (!a) return;
    const done = await run(() =>
      act(() => (a === "remove" ? api.removeMember(share.shareId, m.id) : a === "transfer" ? api.transferShare(share.shareId, m.id) : api.setMemberRole(share.shareId, m.id, a as "editor" | "viewer")), true).then(() => true),
    );
    if (done) void reload();
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      <PageHeader title={name} sub={owner ? "Shared by you" : `Your role: ${ROLE[share.role].toLowerCase()}`} back={back} />
      <Label inset>Members</Label>
      {members.map((m) => (
        <NavRow
          key={m.id}
          icon="user"
          title={m.id === me ? `${nameOf(m)} (you)` : nameOf(m)}
          sub={`${m.status === "invited" ? "Invited · " : ""}${ROLE[m.role]}`}
          chevron={owner && m.id !== me ? "more-horizontal" : undefined}
          onPress={() => void member(m)}
        />
      ))}
      {owner ? (
        <>
          <NavRow icon="user-plus" title="Invite a friend" onPress={() => void invite()} />
          <NavRow icon="link" title="Share a link" sub="Lasts 7 days" onPress={() => void link()} />
          <View style={{ paddingHorizontal: GUTTER, paddingTop: 24 }}>
            <Button label="Stop sharing" icon="x-circle" kind="outline" onPress={stop} />
          </View>
          <Text variant="meta" style={{ color: c.muted, paddingHorizontal: GUTTER, paddingTop: 8 }}>
            To leave, make someone else the owner first.
          </Text>
        </>
      ) : (
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 24 }}>
          <Button label="Leave" icon="log-out" kind="outline" onPress={leave} />
        </View>
      )}
    </ScrollView>
  );
}
