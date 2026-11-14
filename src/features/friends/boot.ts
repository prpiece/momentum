import { showNotice } from "../../lib/os";
import { setNudgeHandler, startSocial } from "../../stores/social";
import { watchFocus } from "./focusSession";

/** Main window only: follows sign-in for friends, shows nudges as notifications, publishes focus sessions. */
export function startFriends() {
  setNudgeHandler((from, habit) => showNotice("Momentum", `${from ? `@${from.handle}` : "A friend"} nudged you about ${habit ? `"${habit}"` : "your habit"}`));
  startSocial();
  watchFocus();
}
