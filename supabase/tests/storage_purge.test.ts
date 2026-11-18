/*
 * Account deletion removes the account's Storage files (backups, note images, report screenshots),
 * through the queue and the storage-purge function, and leaves other accounts' files alone.
 */
import { describe, expect, it } from "vitest";
import { handle } from "../functions/storage-purge/app";
import { admin, rpc, SECRET, send, task, list, uid, URL, user, type User } from "./helpers";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const env = { SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: SECRET, STORAGE_PURGE_SECRET: "purge-secret" };
const runPurge = (secret = "purge-secret") =>
  handle(new Request("http://local/functions/v1/storage-purge", { method: "POST", headers: { "x-cron-secret": secret } }), env);
const exists = async (bucket: string, path: string) => !(await admin().storage.from(bucket).download(path)).error;

/** A signed-in account with a backup, a note image on a task that references it, and a report screenshot. */
async function withFiles(u: User) {
  const l = uid(), t = uid(), img = `${uid()}.png`, rid = uid();
  const paths = { backup: `${u.id}/momentum-auto-1.json`, note: `notes/${img}`, shot: `${rid}/screenshot.png` };
  await send(u.db, list(l), task(t, l, { description: `![](attachment:${img})` }));
  expect((await u.db.storage.from("backups").upload(paths.backup, "{}", { contentType: "application/json" })).error).toBeNull();
  expect((await u.db.storage.from("attachments").upload(paths.note, png, { contentType: "image/png" })).error).toBeNull();
  expect((await u.db.storage.from("reports").upload(paths.shot, png, { contentType: "image/png" })).error).toBeNull();
  const rep = await u.db.from("reports").insert({
    id: rid, name: "n", email: "a@b.test", body: "a report body", app_version: "1", platform: "test", screenshot_path: paths.shot,
  });
  expect(rep.error).toBeNull();
  return paths;
}

describe("account deletion and Storage", () => {
  it("removes the purged account's files and keeps everyone else's", async () => {
    const [gone, other] = await Promise.all([user(), user()]);
    const g = await withFiles(gone), o = await withFiles(other);

    await rpc(gone.db, "request_account_deletion");
    await admin().from("account_deletions").update({ requested_at: new Date(Date.now() - 8 * 86_400_000).toISOString() }).eq("owner_id", gone.id);
    expect((await admin().rpc("purge_deleted")).error).toBeNull();
    expect((await admin().auth.admin.getUserById(gone.id)).data.user).toBeNull();

    // Queued, not yet removed: the files go through the Storage API.
    const queued = (await admin().from("storage_purge").select("bucket, name")).data ?? [];
    expect(queued).toEqual(expect.arrayContaining([
      { bucket: "backups", name: g.backup }, { bucket: "attachments", name: g.note }, { bucket: "reports", name: g.shot },
    ]));
    expect(queued).not.toContainEqual({ bucket: "backups", name: o.backup });

    expect((await runPurge("wrong")).status).toBe(401);
    expect((await runPurge()).status).toBe(200);
    expect(await exists("backups", g.backup)).toBe(false);
    expect(await exists("attachments", g.note)).toBe(false);
    expect(await exists("reports", g.shot)).toBe(false);
    expect((await admin().from("reports").select("id").eq("screenshot_path", g.shot)).data).toEqual([]);
    expect(await exists("backups", o.backup)).toBe(true);
    expect(await exists("attachments", o.note)).toBe(true);
    expect(await exists("reports", o.shot)).toBe(true);
    expect((await admin().from("storage_purge").select("name").eq("name", g.backup)).data).toEqual([]);

    // Running both again changes nothing.
    expect((await admin().rpc("purge_deleted")).error).toBeNull();
    expect((await runPurge()).status).toBe(200);
    expect(await exists("backups", o.backup)).toBe(true);
  });
});

async function invite(owner: User, share: string, member: User, role: "editor" | "viewer") {
  const code = await rpc<string>(owner.db, "create_share_invite", { p_share: share, p_role: role });
  await rpc(member.db, "redeem_invite", { p_code: code });
}
const purge = async (u: User) => {
  await rpc(u.db, "request_account_deletion");
  await admin().from("account_deletions").update({ requested_at: new Date(Date.now() - 8 * 86_400_000).toISOString() }).eq("owner_id", u.id);
  expect((await admin().rpc("purge_deleted")).error).toBeNull();
};
const queuedNames = async () => ((await admin().from("storage_purge").select("name")).data ?? []).map((r) => r.name as string);

describe("what a purge keeps", () => {
  it("keeps the files of a share that was passed on, including a note image a passed-on task still uses", async () => {
    const [o, heir] = await Promise.all([user(), user()]);
    const l = uid(), t = uid(), img = `${uid()}.png`, file = `share/PLACEHOLDER/${l}/${uid()}.png`;
    await send(o.db, list(l), task(t, l, { description: `![](attachment:${img})` }));
    const s = await rpc<string>(o.db, "create_share", { p_kind: "list", p_container: l });
    await invite(o, s, heir, "editor");
    const shared = file.replace("PLACEHOLDER", s);
    expect((await o.db.storage.from("attachments").upload(`notes/${img}`, png, { contentType: "image/png" })).error).toBeNull();
    expect((await o.db.storage.from("attachments").upload(shared, png, { contentType: "image/png" })).error).toBeNull();
    await purge(o);
    const queued = await queuedNames();
    expect(queued).not.toContain(`notes/${img}`);
    expect(queued).not.toContain(shared);
    await runPurgeSafe();
    expect(await exists("attachments", `notes/${img}`)).toBe(true);
    expect(await exists("attachments", shared)).toBe(true);
    expect((await heir.db.storage.from("attachments").download(shared)).error).toBeNull();
  });

  it("queues the files of a share nobody inherited, other members' uploads included", async () => {
    const [o, viewer] = await Promise.all([user(), user()]);
    const l = uid(), t = uid();
    await send(o.db, list(l), task(t, l));
    const s = await rpc<string>(o.db, "create_share", { p_kind: "list", p_container: l });
    await invite(o, s, viewer, "viewer");
    const mine = `share/${s}/${l}/${uid()}.png`;
    expect((await o.db.storage.from("attachments").upload(mine, png, { contentType: "image/png" })).error).toBeNull();
    await purge(o);
    expect(await queuedNames()).toContain(mine);
    await runPurgeSafe();
    expect(await exists("attachments", mine)).toBe(false);
  });
});

const runPurgeSafe = async () => expect((await runPurge()).status).toBe(200);

