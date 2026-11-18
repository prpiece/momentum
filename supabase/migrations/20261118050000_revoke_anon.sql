-- Explicit privileges, as every earlier migration has them: the comment functions were granted to
-- `authenticated` but never revoked from public/anon, and the two ping tables never had the usual
-- revoke. Authenticated keeps what the app uses (execute; select on its own pings for Realtime).

revoke all on function public.task_comments(text), public.add_task_comment(text, text),
  public.edit_task_comment(uuid, text), public.delete_task_comment(uuid) from public, anon;
grant execute on function public.task_comments(text), public.add_task_comment(text, text),
  public.edit_task_comment(uuid, text), public.delete_task_comment(uuid) to authenticated;

revoke all on public.social_pings, public.sync_pings from public, anon, authenticated;
grant select on public.social_pings, public.sync_pings to authenticated;

update public.server_meta set schema_version = 17;
