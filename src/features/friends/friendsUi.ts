import { create } from "zustand";
import { SERVER_UPDATE_MESSAGE } from "../../domain/serverStatus";
import { serverBehind } from "../../lib/sync/serverVersion";
import type { ShareKind } from "../../lib/sync/social";
import { toast } from "../../stores/toast";

/** Which friend dialog is open: sending a task, or sharing a list or folder. */
export const useFriendsUi = create<{ send: string | null; share: { kind: ShareKind; id: string } | null }>(() => ({ send: null, share: null }));
/** Sharing and sending need the server's newer schema (D289): say so instead of opening a dialog that would fail. */
const needsServer = () => serverBehind() && (toast(`${SERVER_UPDATE_MESSAGE}.`), true);
export const openSend = (taskId: string) => needsServer() || useFriendsUi.setState({ send: taskId });
export const openShare = (kind: ShareKind, id: string) => needsServer() || useFriendsUi.setState({ share: { kind, id } });
export const closeFriendDialogs = () => useFriendsUi.setState({ send: null, share: null });
