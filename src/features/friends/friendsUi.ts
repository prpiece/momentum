import { create } from "zustand";
import type { ShareKind } from "../../lib/sync/social";

/** Which friend dialog is open: sending a task, or sharing a list or folder. */
export const useFriendsUi = create<{ send: string | null; share: { kind: ShareKind; id: string } | null }>(() => ({ send: null, share: null }));
export const openSend = (taskId: string) => useFriendsUi.setState({ send: taskId });
export const openShare = (kind: ShareKind, id: string) => useFriendsUi.setState({ share: { kind, id } });
export const closeFriendDialogs = () => useFriendsUi.setState({ send: null, share: null });
