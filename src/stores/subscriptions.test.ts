import { expect, it } from "vitest";
import { replaceAll, useData } from "./data";
import { refreshSubscription, removeSubscription, setFeedFetcher, useSubscriptions } from "./subscriptions";

const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nDTSTART:20261116T150000Z\r\nDTEND:20261116T160000Z\r\nUID:a@x\r\nSUMMARY:Planning\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

it("removing a subscription while its feed downloads doesn't bring its events back", async () => {
  replaceAll({ tasks: [], events: [], lists: [], folders: [], sections: [], tags: [] });
  const sub = { id: "s1", name: "Work", url: "https://example.com/a.ics", color: "#2f9358", sortOrder: 0, createdAt: "2026-11-01T00:00:00.000Z", deletedAt: null };
  useSubscriptions.setState({ subs: { s1: sub }, status: {} });
  let release: (t: string) => void = () => undefined;
  setFeedFetcher(() => new Promise<string>((r) => (release = r)));
  const refreshing = refreshSubscription("s1");
  removeSubscription("s1");
  release(ICS);
  await refreshing;
  expect(Object.values(useData.getState().events).filter((e) => !e.deletedAt)).toHaveLength(0);
});
