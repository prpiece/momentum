import { beforeEach, expect, it, vi } from "vitest";

// The upload queue (D291) against a fake bucket: what goes up, what counts as done, what retries.
const stored = new Map<string, Blob>();
let fail: { statusCode: string; message: string } | null = null;
const upload = vi.fn(async (path: string, blob: Blob) => {
  if (fail) return { error: fail };
  if (stored.has(path)) return { error: { statusCode: "409", message: "The resource already exists" } };
  stored.set(path, blob);
  return { error: null };
});
const download = vi.fn(async () => ({ data: new Blob([new Uint8Array(4)]), error: null }));
const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: "https://x/s" }, error: null }));
vi.mock("./supabase", () => ({ supabase: { storage: { from: () => ({ upload, download, createSignedUrl }) } } }));
const state = new Map<string, string>();
vi.mock("./engine", () => ({
  useSync: { getState: () => ({ account: "me" }) },
  state: async (k: string) => state.get(k) ?? null,
  setLocalState: async (k: string, v: string) => void state.set(k, v),
}));
const { uploadNoteImages, downloadNoteImage, noteImageUrl } = await import("./attachments");

const files = (names: string[], size = 4) => ({ list: async () => names, read: async () => new Blob([new Uint8Array(size)]) });
const notes = ["![](attachment:a.png) ![](attachment:b.jpg)"];

beforeEach(() => {
  stored.clear();
  state.clear();
  upload.mockClear();
  fail = null;
});

it("uploads each referenced local image once, and skips settled ones on later syncs", async () => {
  await uploadNoteImages(files(["a.png", "b.jpg", "stray.png"]), notes);
  expect([...stored.keys()].sort()).toEqual(["notes/a.png", "notes/b.jpg"]);
  await uploadNoteImages(files(["a.png", "b.jpg"]), notes);
  expect(upload).toHaveBeenCalledTimes(2);
});

it("counts a duplicate as done (another device uploaded it, or a lost settled list)", async () => {
  stored.set("notes/a.png", new Blob());
  await uploadNoteImages(files(["a.png"]), notes);
  await uploadNoteImages(files(["a.png"]), notes);
  expect(upload).toHaveBeenCalledTimes(1);
});

it("retries a refused upload on the next sync", async () => {
  fail = { statusCode: "403", message: "new row violates row-level security policy" };
  await uploadNoteImages(files(["a.png"]), notes);
  fail = null;
  await uploadNoteImages(files(["a.png"]), notes);
  expect(upload).toHaveBeenCalledTimes(2);
  expect(stored.has("notes/a.png")).toBe(true);
});

it("never sends a file over the size cap", async () => {
  await uploadNoteImages(files(["a.png"], 10 * 1024 * 1024 + 1), notes);
  expect(upload).not.toHaveBeenCalled();
});

it("never reaches the bucket for a name that isn't a plain attachment file name (notes are untrusted)", async () => {
  for (const bad of ["../other-uid/x.png", "a/b.png", "..\\x.png", "a.png/../b.png", "x.png\n"]) {
    expect(await downloadNoteImage(bad)).toBeNull();
    expect(await noteImageUrl(bad)).toBeNull();
  }
  expect(download).not.toHaveBeenCalled();
  expect(createSignedUrl).not.toHaveBeenCalled();
  expect(await downloadNoteImage("ok-1_a.png")).not.toBeNull();
  expect(download).toHaveBeenCalledWith("notes/ok-1_a.png");
  expect(await noteImageUrl("ok-1_a.png")).toBe("https://x/s");
});
