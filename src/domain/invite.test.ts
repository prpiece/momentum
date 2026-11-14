import { describe, expect, it } from "vitest";
import { handleFrom, inviteCodeFrom, inviteUrl } from "./invite";

describe("invite links", () => {
  it("reads the code from the app link, the web page or a bare code", () => {
    expect(inviteCodeFrom("momentum://invite/Ab3dEf7hJk")).toBe("Ab3dEf7hJk");
    expect(inviteCodeFrom(inviteUrl("Ab3dEf7hJk"))).toBe("Ab3dEf7hJk");
    expect(inviteCodeFrom("https://prpiece.github.io/momentum/invite?c=Ab3dEf7hJk")).toBe("Ab3dEf7hJk");
    expect(inviteCodeFrom("  Ab3dEf7hJk ")).toBe("Ab3dEf7hJk");
  });

  it("refuses other sites and malformed codes", () => {
    expect(inviteCodeFrom("https://evil.example/momentum/invite/?c=Ab3dEf7hJk")).toBeNull();
    expect(inviteCodeFrom("momentum://invite/short")).toBeNull();
    expect(inviteCodeFrom(inviteUrl("bad code!!"))).toBeNull();
    expect(inviteCodeFrom("")).toBeNull();
  });

  it("normalises handles", () => {
    expect(handleFrom("@Sam_01")).toBe("sam_01");
    expect(handleFrom("no spaces")).toBeNull();
    expect(handleFrom("ab")).toBeNull();
  });
});
