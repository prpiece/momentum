import { expect, it } from "vitest";
import { dialogOpen, trackDialog } from "./openDialogs";

it("is open while any dialog is tracked, and a double release counts once", () => {
  expect(dialogOpen()).toBe(false);
  const a = trackDialog();
  const b = trackDialog();
  a();
  a();
  expect(dialogOpen()).toBe(true);
  b();
  expect(dialogOpen()).toBe(false);
});
