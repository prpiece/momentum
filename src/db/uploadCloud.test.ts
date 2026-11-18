import { beforeEach, describe, expect, it, vi } from "vitest";

const bucket = { upload: vi.fn(), list: vi.fn(), remove: vi.fn() };
vi.mock("../lib/sync/supabase", () => ({ supabase: { storage: { from: () => bucket } } }));
const { uploadCloud } = await import("./backup");
const { encryptBackup } = await import("./backupCrypto");
const sealed = await encryptBackup("{}", "pass"); // cloud copies must be encrypted (C3)

const names = Array.from({ length: 5 }, (_, i) => `momentum-auto-2026-11-0${i + 1}-00-00-00.json`);

describe("uploadCloud", () => {
  beforeEach(() => vi.resetAllMocks());

  it("prunes beyond keep after a good upload", async () => {
    bucket.upload.mockResolvedValue({ error: null });
    bucket.list.mockResolvedValue({ data: names.map((name) => ({ name })), error: null });
    await uploadCloud("u1", "x", sealed, 3);
    expect(bucket.remove).toHaveBeenCalledWith(names.slice(0, 2).map((n) => `u1/${n}`));
  });

  it("refuses a plaintext payload before touching the bucket", async () => {
    await expect(uploadCloud("u1", "x", "{}", 3)).rejects.toThrow("encrypted");
    expect(bucket.upload).not.toHaveBeenCalled();
  });

  it("still prunes when the server refuses the upload, then rethrows its error", async () => {
    bucket.upload.mockResolvedValue({ error: { message: "new row violates row-level security policy" } });
    bucket.list.mockResolvedValue({ data: names.map((name) => ({ name })), error: null });
    await expect(uploadCloud("u1", "x", sealed, 3)).rejects.toThrow("row-level security");
    expect(bucket.remove).toHaveBeenCalledTimes(1);
  });
});
