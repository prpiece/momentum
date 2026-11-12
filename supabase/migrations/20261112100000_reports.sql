-- "Report a problem" (PLAN D232 batch). Anyone, signed in or not, can send a report and an optional
-- screenshot; nobody can read them through the API (read them in the dashboard or with the service role).

create table public.reports (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid default auth.uid() references auth.users on delete set null,
  name            text not null check (char_length(name) <= 100),
  email           text not null check (char_length(email) between 3 and 254 and email like '%_@_%'),
  body            text not null check (char_length(body) between 10 and 5000),
  app_version     text not null check (char_length(app_version) <= 32),
  platform        text not null check (char_length(platform) <= 32),
  screenshot_path text check (screenshot_path is null or (char_length(screenshot_path) <= 200 and screenshot_path like id::text || '/%')),
  created_at      timestamptz not null default now()
);
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant insert (id, name, email, body, app_version, platform, screenshot_path) on public.reports to anon, authenticated;
create policy reports_insert on public.reports for insert to anon, authenticated with check (user_id is null or user_id = (select auth.uid()));

-- Private bucket, 5 MB images only, insert-only (no select, update or delete policy).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reports', 'reports', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;
create policy reports_upload on storage.objects for insert to anon, authenticated with check (bucket_id = 'reports');
