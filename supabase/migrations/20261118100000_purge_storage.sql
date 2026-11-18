-- Account deletion also removes the account's Storage files. Deleting `storage.objects` rows in SQL
-- is not enough (the files stay in the bucket, and hosted Storage blocks direct deletes), so
-- purge_deleted() queues the doomed object names here and the `storage-purge` Edge Function removes
-- them through the Storage API. The queue is retried until the API succeeds, and removing a file
-- that is already gone is a no-op, so re-running anything here is safe.
--
-- What belongs to a deleted account G:
--   backups/<G>/...              all of it
--   notes/<file> uploaded by G   unless a task still references the file (a passed-on shared task)
--   share/<id>/... files         when G owned share <id> and nobody inherited it (the share is gone,
--                                so every member's upload there is unreachable too); shares that were
--                                passed on keep all their files, including G's uploads
--   reports/<id>/... screenshots of G's own reports, and those report rows (they carry G's name and email)
-- Anonymous reports can't be tied to an account and stay.

create table public.storage_purge (
  bucket    text not null,
  name      text not null,
  queued_at timestamptz not null default now(),
  primary key (bucket, name)
);
alter table public.storage_purge enable row level security;
revoke all on public.storage_purge from anon, authenticated;

/* As in 20261115000000_v121_fixes.sql, plus the queueing. */
create or replace function public.purge_deleted() returns void
language plpgsql security definer set search_path = '' as $$
declare
  gone uuid;
  mine text[];
  keep text[] := array['deleted_at', 'list_id', 'folder_id', 'parent_id', 'task_id'];
begin
  for gone in select d.owner_id from public.account_deletions d where d.requested_at < now() - interval '7 days' loop
    select coalesce(array_agg(s.id::text), '{}') into mine from public.shares s where s.owner_id = gone;
    perform public.pass_on_shares(gone);
    insert into public.storage_purge (bucket, name)
      select 'backups', o.name from storage.objects o
      where o.bucket_id = 'backups' and (storage.foldername(o.name))[1] = gone::text
      on conflict do nothing;
    with r as (delete from public.reports where user_id = gone returning screenshot_path)
    insert into public.storage_purge (bucket, name) select 'reports', screenshot_path from r where screenshot_path is not null
      on conflict do nothing;
    delete from auth.users where id = gone;
    -- After the delete: the account's records are gone, so "still referenced" and "share still exists" are final.
    insert into public.storage_purge (bucket, name)
      select 'attachments', o.name from storage.objects o
      where o.bucket_id = 'attachments' and (
        ((storage.foldername(o.name))[1] = 'share' and (storage.foldername(o.name))[2] = any(mine)
          and not exists (select 1 from public.shares s where s.id::text = (storage.foldername(o.name))[2]))
        or ((storage.foldername(o.name))[1] = 'notes' and o.owner_id = gone::text
          and not exists (select 1 from public.sync_rows r where r.tbl = 'tasks'
                          and public.note_attachments(r.data->>'description') @> array[storage.filename(o.name)])))
      on conflict do nothing;
  end loop;
  -- ponytail: a full scan of sync_rows once a day; index deleted records if it gets slow.
  update public.sync_rows set data = public.pick(data, keep)
  where data->>'deleted_at' ~ '^\d{4}-\d\d-\d\dT'
    and public.try_instant(data->>'deleted_at') < now() - interval '30 days'
    and data <> public.pick(data, keep);
end $$;

/* pg_cron: asks the storage-purge function to empty the queue (only when its URL and secret are configured). */
create function public.run_storage_purge() returns void
language plpgsql security definer set search_path = '' as $$
declare
  url text := (select value from public.server_secrets where key = 'storage_purge_url');
  secret text := (select value from public.server_secrets where key = 'storage_purge_secret');
begin
  if url is null or secret is null or not exists (select 1 from public.storage_purge) then return; end if;
  perform net.http_post(url := url, body := '{}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', secret));
end $$;

revoke all on function public.run_storage_purge() from public, anon, authenticated;
select cron.schedule('storage-purge', '*/10 * * * *', 'select public.run_storage_purge()');

update public.server_meta set schema_version = 21;
