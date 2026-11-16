import { describe, expect, it } from "vitest";
import { cloudExcess, decryptBackup, encryptBackup, isEncryptedBackup } from "./backupCrypto";

describe("backup encryption", () => {
  it("round-trips and is detected", async () => {
    const text = await encryptBackup('{"tasks":[1,2]}', "correct horse");
    expect(isEncryptedBackup(text)).toBe(true);
    expect(text).not.toContain("tasks");
    expect(await decryptBackup(text, "correct horse")).toBe('{"tasks":[1,2]}');
  });
  it("rejects a wrong passphrase and tampering", async () => {
    const text = await encryptBackup("{}", "a");
    await expect(decryptBackup(text, "b")).rejects.toThrow(/Wrong passphrase/);
    const e = JSON.parse(text) as { data: string };
    e.data = (e.data[0] === "A" ? "B" : "A") + e.data.slice(1);
    await expect(decryptBackup(JSON.stringify(e), "a")).rejects.toThrow(/Wrong passphrase/);
  });
  it("leaves plain backups alone", () => {
    expect(isEncryptedBackup('{"app":"Momentum","format":1}')).toBe(false);
    expect(isEncryptedBackup("nope")).toBe(false);
  });
});

describe("cloudExcess", () => {
  it("lists the oldest beyond keep, ignoring other files", () => {
    const n = ["momentum-auto-2026-11-14.json", "momentum-auto-2026-11-16.json", "x.txt", "momentum-auto-2026-11-15.json"];
    expect(cloudExcess(n, 2)).toEqual(["momentum-auto-2026-11-14.json"]);
    expect(cloudExcess(n, 7)).toEqual([]);
  });
});
