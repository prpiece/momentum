import { describe, expect, it, vi } from "vitest";
import { autoBackupDue, autoBackupSettings, saveAutoBackupSettings } from "./backup";

describe("cloud copies are never plaintext", () => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  it("normaliser drops cloud without encrypt (old rows, removed passphrase)", () => {
    store.set("momentum.autoBackup", JSON.stringify({ on: true, cloud: true, encrypt: false }));
    expect(autoBackupSettings().cloud).toBe(false);
    store.set("momentum.autoBackup", JSON.stringify({ on: true, cloud: true, encrypt: true }));
    expect(autoBackupSettings().cloud).toBe(true);
  });
  it("save refuses cloud without encrypt", () => {
    saveAutoBackupSettings({ ...autoBackupSettings(), encrypt: false, cloud: true });
    expect(JSON.parse(store.get("momentum.autoBackup")!).cloud).toBe(false);
  });
});

describe("autoBackupDue", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  it("is due when on and never run or older than 20h", () => {
    expect(autoBackupDue({ on: true, last: null }, now)).toBe(true);
    expect(autoBackupDue({ on: true, last: "2026-11-15T12:00:00Z" }, now)).toBe(true);
  });
  it("is not due when off or recent", () => {
    expect(autoBackupDue({ on: false, last: null }, now)).toBe(false);
    expect(autoBackupDue({ on: true, last: "2026-11-16T05:00:00Z" }, now)).toBe(false);
  });
});
