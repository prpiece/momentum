-- in_share() counted a merely invited member, so an invitee (or any member) could read every pending
-- invitee's row through the table API, bypassing share_people() (SOC-13), and an invitee could read the
-- share row before accepting. The apps read shares only through functions (my_shares, share_people), so
-- the policies tighten without a client change. in_share() itself is left alone (only these two policies used it).

/* The caller is an active member of the share. */
create function public.in_active_share(p_share uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.share_members m where m.share_id = p_share and m.account_id = auth.uid() and m.status = 'active');
$$;

/* The caller may see a member row of this status: the share's owner sees all, an active member sees the active. */
create function public.can_see_member(p_share uuid, p_status text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.share_members m where m.share_id = p_share and m.account_id = auth.uid() and m.status = 'active'
    and (m.role = 'owner' or p_status = 'active'));
$$;
revoke all on function public.in_active_share(uuid), public.can_see_member(uuid, text) from public, anon, authenticated;
grant execute on function public.in_active_share(uuid), public.can_see_member(uuid, text) to authenticated;

drop policy shares_members on public.shares;
create policy shares_members on public.shares for select to authenticated using (public.in_active_share(id));
drop policy share_members_members on public.share_members;
create policy share_members_members on public.share_members for select to authenticated
  using (account_id = auth.uid() or public.can_see_member(share_id, status));

update public.server_meta set schema_version = 18;
