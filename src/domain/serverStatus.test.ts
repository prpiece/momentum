import { describe, expect, it } from "vitest";
import { failureText, isMissingFunction, serverState } from "./serverStatus";

describe("serverState", () => {
  it("is ok for a numeric version at or above what the app needs", () => {
    expect(serverState({ data: { schema_version: 1 }, error: null })).toBe("ok");
    expect(serverState({ data: { schema_version: 12 }, error: null })).toBe("ok");
  });
  it("counts a server without the column, or without a number in it, as behind", () => {
    expect(serverState({ data: null, error: { code: "42703" } })).toBe("behind");
    expect(serverState({ data: { schema_version: null }, error: null })).toBe("behind");
    expect(serverState({ data: { schema_version: 0 }, error: null })).toBe("behind");
    expect(serverState({ data: { min_client_schema: 9 }, error: null })).toBe("behind");
  });
  it("says nothing on other errors or an empty answer", () => {
    expect(serverState({ data: null, error: { code: "", message: "Failed to fetch" } })).toBe("unknown");
    expect(serverState({ data: null, error: null })).toBe("unknown");
  });
});

describe("server call failures", () => {
  it("names what failed", () => {
    expect(failureText("load your friends", { message: "boom" })).toBe("Couldn't load your friends. Try again.");
    expect(failureText("load your friends", { message: "TypeError: Failed to fetch" })).toContain("connection");
  });
  it("knows a function the server lacks", () => {
    expect(isMissingFunction({ code: "PGRST202" })).toBe(true);
    expect(isMissingFunction({ code: "23505" })).toBe(false);
  });
});
