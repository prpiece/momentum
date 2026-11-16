import { expect, it } from "vitest";
import { askScope, confirm } from "./ui";

it("DATA-12: a second prompt resolves the first instead of orphaning it", async () => {
  const first = confirm("a", "b");
  const second = confirm("c", "d");
  expect(await first).toBe(false);
  const s1 = askScope("edit");
  void askScope("delete");
  expect(await s1).toBeNull();
  void second;
});
