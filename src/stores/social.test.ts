import { describe, expect, it, vi } from "vitest";

const myFriends = vi.fn();
vi.mock("../lib/sync/social", () => ({
  myFriends: (...a: unknown[]) => myFriends(...a),
  incomingTasks: async () => [], outgoingTasks: async () => [], myShares: async () => [], buddyHabits: async () => [], myBuddies: async () => [], friendsFocusing: async () => [],
}));
vi.mock("../lib/sync/serverVersion", () => ({ checkServerVersion: async () => undefined, resetServerVersion: () => undefined, serverBehind: () => false }));
vi.mock("../lib/sync/engine", () => ({ useSync: { getState: () => ({ account: "me" }) }, setLocalState: async () => undefined, state: async () => null, syncNow: async () => undefined }));
vi.mock("../lib/sync/supabase", () => ({ supabase: {} }));
vi.mock("./data", () => ({ setEditGuard: () => undefined, useData: { getState: () => ({}) } }));
vi.mock("./habits", () => ({ useHabits: {} }));

import { refreshSocial, useSocial } from "./social";

describe("refreshSocial", () => {
  it("a call during a refresh reruns it, so the action's change shows", async () => {
    let release!: () => void;
    myFriends.mockReturnValueOnce(new Promise((r) => (release = () => r([{ id: "old" }]))));
    myFriends.mockResolvedValueOnce([{ id: "new" }]);
    const first = refreshSocial();
    await Promise.resolve();
    const second = refreshSocial(); // the user's action finished while the first was in flight
    release();
    await Promise.all([first, second]);
    expect(useSocial.getState().friends).toEqual([{ id: "new" }]);
  });
});
