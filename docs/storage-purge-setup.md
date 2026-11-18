# Account deletion and Storage: setup

When an account is purged (7 days after the request), `purge_deleted()` queues the account's Storage files in `public.storage_purge`, and the `storage-purge` Edge Function removes them through the Storage API. Deleting `storage.objects` rows in SQL is not enough: the files stay in the bucket, and hosted Storage blocks direct deletes. Nothing here has a value filled in on purpose.

`<project-ref>` is the Supabase project ref (Dashboard → Project Settings → General). The function's URL is

```
https://<project-ref>.supabase.co/functions/v1/storage-purge
```

## 1. Before you start: check the Storage schema

In the SQL editor, make sure `storage.objects` has no foreign key to `auth.users` (it would make the user delete fail while the account still has files):

```sql
select conname from pg_constraint
where conrelid = 'storage.objects'::regclass and confrelid = 'auth.users'::regclass;
```

No rows is the expected answer on current Storage. If a row comes back, stop and ask before applying the migration.

## 2. Migration, secret and deploy

Generate the secret (any machine with OpenSSL or Node):

```
openssl rand -hex 32      # STORAGE_PURGE_SECRET
# or: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

From the repo root, logged in (`npx supabase login`) and linked (`npx supabase link --project-ref <project-ref>`):

```
npx supabase db push
npx supabase secrets set STORAGE_PURGE_SECRET=<hex>
npx supabase functions deploy storage-purge
```

`supabase/config.toml` already sets `verify_jwt = false` for `storage-purge` (pg_cron sends no Supabase token; the function checks `x-cron-secret` itself). If you deploy from somewhere that ignores the config, add `--no-verify-jwt`.

## 3. The 10-minute job (pg_cron)

Migration `20261118100000_purge_storage.sql` schedules `storage-purge` every 10 minutes. It does nothing until the address and the secret are in `server_secrets`, and it only calls the function when the queue has rows. In the SQL editor:

```sql
insert into public.server_secrets (key, value) values
  ('storage_purge_url', 'https://<project-ref>.supabase.co/functions/v1/storage-purge'),
  ('storage_purge_secret', '<the same STORAGE_PURGE_SECRET>')
on conflict (key) do update set value = excluded.value;
```

Each run removes up to 2000 queued files. A file the Storage API refuses is logged, moved to the back of the queue and retried on later runs; it never blocks the rest. Check progress with:

```sql
select bucket, count(*), min(queued_at) from public.storage_purge group by bucket;
select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'storage-purge') order by start_time desc limit 5;
```

and the function's logs (Dashboard → Edge Functions → storage-purge → Logs). A row that stays in the queue for days points at a file the API keeps refusing.

## 4. One-off backfill: accounts purged before this migration

Accounts purged earlier left their files behind. This queues the ones that can be attributed to an account that no longer exists. It is safe to run more than once (`on conflict do nothing`), and the cron job then removes the files.

```sql
-- Backups of accounts that no longer exist: backups/<uid>/...
insert into public.storage_purge (bucket, name)
select 'backups', o.name from storage.objects o
where o.bucket_id = 'backups'
  and (storage.foldername(o.name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and not exists (select 1 from auth.users u where u.id::text = (storage.foldername(o.name))[1])
on conflict do nothing;

-- Note images uploaded by an account that no longer exists, when no task references the file
-- (a passed-on shared task still does, so its images stay).
insert into public.storage_purge (bucket, name)
select 'attachments', o.name from storage.objects o
where o.bucket_id = 'attachments' and (storage.foldername(o.name))[1] = 'notes'
  and not exists (select 1 from auth.users u where u.id::text = o.owner_id)
  and not exists (select 1 from public.sync_rows r where r.tbl = 'tasks'
                  and public.note_attachments(r.data->>'description') @> array[storage.filename(o.name)])
on conflict do nothing;

-- Share files uploaded by an account that no longer exists, in a share that no longer exists.
insert into public.storage_purge (bucket, name)
select 'attachments', o.name from storage.objects o
where o.bucket_id = 'attachments' and (storage.foldername(o.name))[1] = 'share'
  and not exists (select 1 from auth.users u where u.id::text = o.owner_id)
  and not exists (select 1 from public.shares s where s.id::text = (storage.foldername(o.name))[2])
on conflict do nothing;
```

Check the counts before the cron job runs (`select bucket, count(*) from public.storage_purge group by bucket;`) and compare them with what you expect. To undo a mistake before the job runs, `delete from public.storage_purge where ...`.

Not backfilled, on purpose:

- **Report screenshots and rows.** A report's `user_id` is null both for an anonymous report and for one whose author was deleted, so the two can't be told apart; deleting by `user_id is null` would remove other people's reports. Review them in the dashboard if you want them gone. From now on, the purge deletes an account's own reports and screenshots while the account still exists.
- **Files other members uploaded to a share whose owner was deleted** (their `owner_id` is a live account). They are unreachable, but can't be attributed to the deleted account from Storage alone.
