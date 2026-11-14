import { SendToFriendDialog } from "./SendToFriendDialog";
import { ShareContainerDialog } from "./ShareContainerDialog";
import { closeFriendDialogs, useFriendsUi } from "./friendsUi";

/** Mounted once in the app: the dialogs the task and list menus open. */
export function FriendDialogs() {
  const send = useFriendsUi((s) => s.send);
  const share = useFriendsUi((s) => s.share);
  return (
    <>
      {send && <SendToFriendDialog taskId={send} onClose={closeFriendDialogs} />}
      {share && <ShareContainerDialog kind={share.kind} id={share.id} onClose={closeFriendDialogs} />}
    </>
  );
}
