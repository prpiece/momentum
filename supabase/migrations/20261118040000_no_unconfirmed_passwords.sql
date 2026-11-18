-- AUTH: a password set while the email is unconfirmed must never survive confirmation.
-- The app signs in by email code only. Without this, password /signup(victim@x.com) leaves an unconfirmed user holding
-- the attacker's password; when the victim later confirms by code, GoTrue may keep that password (depends on version).
-- So an unconfirmed user never stores a password, and confirming without setting one clears any that is there.
-- Admin-created confirmed users (tests) and admin confirm+password in one update are untouched.
create or replace function public.clear_unconfirmed_password() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.email_confirmed_at is null then new.encrypted_password := ''; end if;
  elsif old.email_confirmed_at is null and new.email_confirmed_at is not null
        and new.encrypted_password is not distinct from old.encrypted_password then
    new.encrypted_password := '';
  end if;
  return new;
end $$;

-- A trigger function can't be called directly, so no revoke is needed (and revoking would block supabase_auth_admin, which fires it).
drop trigger if exists clear_unconfirmed_password on auth.users;
create trigger clear_unconfirmed_password before insert or update of email_confirmed_at on auth.users
  for each row execute function public.clear_unconfirmed_password();

update public.server_meta set schema_version = 16;
