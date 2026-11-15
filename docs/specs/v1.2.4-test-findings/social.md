# Friends, shares, server security (SOC)

Scope: supabase/ (RLS, functions), src/features/friends/, src/stores/social.ts. Part of the [v1.2.4 test findings](README.md). Each entry says whether a probe test proved it or it rests on reading the code; prove it with a failing test before fixing (the v1.2.1 rule).

Method: static reading of every migration, the `inbound` Edge Function, the client social code and docs. No Docker, so nothing here was executed against a database; every "Proven" is "reasoning only" unless a grep or a code read is the proof (a missing UI call site, a missing check). No service_role key or bot token is committed (only the `sb_publishable_` key in `.env`, which is public by design). All SECURITY DEFINER functions set `search_path = ''`, and I found no RLS policy that lets one user read or write another user's rows directly.

### SOC-01 · medium · bug · Mobile deep link `momentum://invite/<code>` redeems with no preview or confirmation
- [ ] Status: open
- Where: mobile/src/app/invite/[code].tsx:11 -> mobile/src/social/actions.ts:71 `openLink` -> src/stores/social.ts `openInvite` -> `redeem_invite`. `invite_info` (20261114020000_shares.sql, "What a link offers") has a client wrapper (`inviteInfo` in src/lib/sync/social.ts) that nothing calls.
- Proven: reasoning only (grep: `inviteInfo` has zero call sites; the route calls `openLink` in a `useEffect` on mount).
- What happens: any web page, QR code or message that opens `momentum://invite/<attacker code>` makes the phone redeem it immediately. A friend link makes the victim a friend of the attacker (`befriend`): the attacker can read the victim's profile row (handle, display name, avatar, time_zone, share_focus), see their focus status if sharing is on, and send them tasks. A share link (editor or viewer, `active` at once, no accept step) puts attacker-authored lists into the victim's app. When signed out, the code is persisted (`pending_invite`) and silently applied at the next sign-in, possibly under a different account than the one that opened the link.
- Repro: host a page with `<a href="momentum://invite/AbCdEfGhJk">` and tap it on a phone where Momentum is signed in.
- Expected: show who the link is from and what it grants (`invite_info`), then require a tap. Never apply a stored pending invite without the same confirmation.
- Suggested fix: in `[code].tsx` call `inviteInfo`, show an Alert with creator handle, share name and role, and call `redeemInvite` only on confirm. Do the same in `applyPendingInvite`. Also fix the desktop toast in src/features/friends/FriendsView.tsx:35: it says "invited... accept it under Requests" for a share link, but `redeem_invite` makes you an active member at once.

### SOC-02 · medium · bug · Accepting a share invitation still works after the owner is unfriended or blocked
- [ ] Status: open
- Where: 20261114020000_shares.sql `respond_share` (no `is_friend` / `is_blocked` check); `block_account` and `remove_friend` (20261114010000_friends.sql) only touch `friendships` and `blocks`.
- Proven: reasoning only.
- What happens: owner A invites friend B (row `status='invited'`). B blocks A, or A is removed. The invited row survives and B's Requests list still shows "Invitation to X", with no sender name because the sender is no longer a friend (RequestsSection `owner()` looks up friends only). If B taps Accept, B joins the blocked person's share, and shared content and profile visibility (`profile_visible` via `share_members`) come back.
- Repro: A invites B; B blocks A; B calls `respond_share(<share>, true)`; B is now an active member.
- Expected: block or unfriend removes pending invitations in both directions, and `respond_share` fails for a blocked pair.
- Suggested fix: in `block_account` (and `remove_friend` for `invited` rows) delete `share_members` rows with `status='invited'` for shares owned by either party. Add an `is_blocked(me, s.owner_id)` check to `respond_share`.

### SOC-03 · medium · feature · Block does not cut shared access, and "hides each account from the other" is not true inside shares
- [ ] Status: open
- Where: 20261114010000_friends.sql comment on `block_account` ("Shares stay."); UI text in src/features/friends/FriendRow.tsx:29 and mobile/src/social/actions.ts:105 ("Shares aren't touched"); `profile_visible` in 20261114020000_shares.sql (visible through any shared `share_members` row, any status).
- Proven: reasoning only. The behaviour is documented, but it is unsafe as a safety feature.
- What happens: a blocked account keeps editing the blocker's shared lists, stays assignable, and keeps reading the blocker's profile (`profiles_read` -> `profile_visible`), including time_zone. The blocker's only recourse is to leave every shared list or remove the person by hand. Removing a friend does not revoke shares either (FriendRow confirm text).
- Repro: A and B share list L (B editor). A blocks B. B can still push to L and read A's profile row.
- Expected: block offers (or forces) removal from shares both ways and ends profile visibility.
- Suggested fix: `block_account` removes the blocked account from the blocker's shares and the blocker from the blocked account's shares (reuse `remove_member` logic with `settle_share`). Keep a confirm that names the lists affected.

### SOC-04 · medium · bug · Removed or blocked members can rejoin through a still-live share link, and links cannot be revoked from either app
- [ ] Status: open
- Where: `remove_member` (20261114020000_shares.sql) never touches `invites`. `revoke_invite` exists (20261114010000_friends.sql) and `revokeInvite` is exported from src/lib/sync/social.ts:126, but nothing in src or mobile calls it (grep). src/features/friends/ShareContainerDialog.tsx shows a link once, with no list of live links.
- Proven: grep for call sites plus reading `remove_member` / `redeem_invite`.
- What happens: share links last 7 days and friend links 30 days, with unlimited uses and no per-redeemer record. Removing a member does not invalidate the link they still hold, so they can redeem it again and come back with the link's role. A leaked link cannot be killed, except through `transfer_share`, which revokes the old owner's links as a side effect (v121 `transfer_share_as`).
- Repro: owner creates an editor link, member M joins, owner removes M, M re-opens the link: `redeem_invite` -> `add_member(..., 'active')`.
- Expected: the owner can list and revoke links; removing a member can revoke the links.
- Suggested fix: a "Links" list in ShareContainerDialog and Friends, backed by `select from invites` (readable via `invites_own`) with a Revoke button calling `revokeInvite`. Add `max_uses` (default 1 for friend links) and decrement it in `redeem_invite`.

### SOC-05 · medium · bug · A friend link auto-befriends any redeemer, with no use limit
- [ ] Status: open
- Where: 20261114020000_shares.sql `redeem_invite` (friend branch calls `befriend(me, i.creator)`); `create_friend_invite` in 20261114010000_friends.sql (30 days, 50 a day).
- Proven: reasoning only.
- What happens: anyone who gets a forwarded friend link becomes a friend instantly, and the creator is never asked. That grants send-task and focus-status visibility. The 200 friend cap can be filled by redeemers, which then blocks the creator's real requests (`too_many_friends`). `redeem_invite` also skips the `friend_declines` 7-day rule.
- Repro: create a link, post it publicly; N accounts redeem it.
- Expected: single-use by default or an approve step; the creator is notified.
- Suggested fix: add `max_uses`/`uses` columns, default friend links to 1 use, and have a multi-use link create a `pending` request instead of an accepted friendship.

### SOC-06 · medium · bug · The 6-digit chat link code is guessable by many throwaway chat identities
- [ ] Status: open
- Where: 20261114040000_connections.sql `create_link_code`, `link_chat`; supabase/functions/inbound/bot.ts `runChat` rate limit (key `ext:<source>:<externalId>`, 60 per hour).
- Proven: reasoning only.
- What happens: the limit is per chat identity, not global. Each Telegram or Discord identity gets 60 guesses an hour against 10^6 codes valid for 10 minutes. With K throwaway identities the odds against one live code are about 60*K / 10^6 per code lifetime (K=1000: 6%), and every account with a code open at that moment adds to it. A hit links the attacker's chat to the victim's account with `permission='full'` (chats default to full): read every task title, `view`, `delete`, `update`, and `send @friend` as the victim, plus a daily Digest of the victim's tasks.
- Repro: script many Telegram bot users sending `link NNNNNN`.
- Expected: global attempt limiting and an unguessable code.
- Suggested fix: a global `hit_rate('link:fail', 30, '1 minute')` counted on `link_chat` failures, and 8 or more characters (or the 32-char connect token from the v1.2.2 spec). Consider defaulting new chats to `permission='add'` until the user raises it.

### SOC-07 · medium · feature · The apps have no control for connection permissions (add-only vs full)
- [ ] Status: open
- Where: the server has `set_connection_permission`, `set_webhook_permission`, `webhook_permission` (20261115000000_v121_fixes.sql), and docs/connections-setup.md says "The app sets this with ...". src/features/settings/ConnectionsSection.tsx calls none of them, and `Connection` in src/lib/sync/social.ts has no `permission` field.
- Proven: grep for those names in src/ and mobile/src returns nothing.
- What happens: every linked chat is full-access, and the webhook is add-only with no way to widen it. A user cannot reduce a chat's access, which makes the link-code finding worse.
- Expected: a per-connection Add only / Full toggle.
- Suggested fix: expose `permission` in the `my_connections` wrapper and add the toggle in `Chat`; add one for the webhook.

### SOC-08 · medium · bug · One global advisory lock is taken by every `sync_push`, including pushes with no shared records
- [ ] Status: open
- Where: 20261114020000_shares.sql `sync_push` ("Shared records take a second, global lock ... ponytail"), also `create_share`, `add_member`, `respond_share`, `remove_member`, `delete_share`, `transfer_share_as`, `server_write`, `insert_inbox_task`.
- Proven: reasoning only.
- What happens: `pg_advisory_xact_lock(hashtextextended('shares', 0))` is taken at the start of every push, for the whole transaction, for all users. One account with a large shared tree can run heavy operations (`apply_scope_change` re-versions every task in the scope; 500 patches per batch; moves and transfers) and hold the lock until the statement timeout, stalling every other user's sync and bot writes. It also serializes the `/send` accept path.
- Repro: build a share with thousands of tasks; push batches that move a list in and out of a shared folder repeatedly.
- Expected: unrelated users do not block each other.
- Suggested fix: take the global lock only when a patch hits a shared table and the record is shared (or lock per owner namespace), and cap work per push.

### SOC-09 · medium · bug · No server-side field validation: one editor or sender can make a shared or sent task unsyncable on other devices
- [ ] Status: open
- Where: `push_shared` (shares.sql / v121) merges any jsonb for editors; `send_task` and `insert_inbox_task` (social.sql, v121) copy `priority`, `due_date`, `checklist`, `description` unvalidated from the sender's payload; sync_rows has only a 1 MB size check (`sync_rows_size`). Local SQLite has `CHECK (priority BETWEEN 0 AND 3)` (src-tauri/migrations/0002_tasks.sql:47).
- Proven: reasoning only (src/domain/sync.ts `planApply` writes known columns with whatever value arrives, and `applyOp` fails the row on a CHECK violation).
- What happens: (1) an editor of a shared list pushes `priority: 99` or an invalid `status`. Every other member's `applyOp` fails that row on each pull, shows a Sync issue, and never gets the task or its later edits. (2) A friend calling `/send` directly with `task.priority = 99`: the Requests screen sanitises it (`payload()` in social.ts), but `respond_sent_task` accepts the raw stored payload, so the Inbox task is written with 99, fails to apply on every device, and the payload is then wiped (content lost). (3) `send_task` does not cap `title` at 500 chars (`insert_inbox_task` raises `bad_title` on accept, so Accept fails with a generic error), and a non-array `subtasks` makes `jsonb_array_elements` fail the same way.
- Repro: `supabase.functions.invoke('inbound/send', {body:{to, task:{title:'x', priority:99}}})`; the recipient accepts.
- Expected: invalid values are rejected or clamped by the server.
- Suggested fix: validate or coerce in `send_task` (title length, `priority` 0..3, `subtasks` array, string types) and add a small type/range check in `push_shared` for the CHECK-constrained columns (`priority`, `status`).

### SOC-10 · medium · bug · Anonymous report endpoint and `reports` bucket allow unlimited spam and storage exhaustion
- [ ] Status: open
- Where: 20261112100000_reports.sql (`reports_insert` for `anon`; `reports_upload` storage policy `with check (bucket_id = 'reports')`); `plan_limits` (friends.sql) promises 10 GB per account.
- Proven: reasoning only.
- What happens: anyone with the public key can insert unlimited report rows (up to 5000 chars) and upload unlimited 5 MB images to any path in `reports`. The project is on the free tier (D259, 1 GB storage), so about 200 uploads fill it, and then legitimate report screenshots and attachment uploads fail. Separately, the 10 GB per-account `plan_limits` figure is larger than the whole free project, so one account can exhaust storage for everyone. `reported_id` also lets an account file unlimited reports against another.
- Repro: loop `storage.from('reports').upload(crypto.randomUUID()+'/a.png', file)` with the anon key.
- Expected: per-IP or per-account limits and a size budget.
- Suggested fix: require auth for the screenshot upload, add a per-account daily count (a `before insert` trigger or an RPC), and set the attachment quota below the project's real capacity.

### SOC-11 · medium · feature · No Block / Report on incoming friend requests, sent tasks or share invitations, and no unblock
- [ ] Status: open
- Where: src/features/friends/RequestsSection.tsx (only Accept/Decline). FriendRow.tsx's menu exists only for accepted friends and outgoing requests (`friends` list excludes incoming pending, FriendsView.tsx:92). `unblock_account` exists server-side but has no client wrapper or UI (grep: no `unblock` in src or mobile).
- Proven: reading the components, plus grep.
- What happens: a stranger's request can only be declined, after which they can re-request in 7 days, 20 a day, with unlimited fresh accounts. There is no way to report the requester or block them from that screen, and a blocked user can never be unblocked from the app.
- Expected: Block and Report next to Accept/Decline, and a Blocked people list with Unblock.
- Suggested fix: add menu items on the request row calling `blockAccount` / `reportAccount`; add `unblockAccount` and a Blocked list (readable via `blocks_own`).

### SOC-12 · medium · feature · No privacy control for who can send friend requests or tasks, no lookup rate limit, no cap on inbound requests
- [ ] Status: open
- Where: `request_friend` (friends.sql), `find_profile`, `send_task` (social.sql).
- Proven: reasoning only.
- What happens: any signed-in account that knows or guesses a handle can drop a pending request on it (20 per sender per day, free signups). `find_profile` and `request_friend` act as an unthrottled handle-existence oracle (`no_such_account` vs `pending`): only successful requests are counted in `friend_request_log`, so dictionary probing is not rate limited. Pending incoming requests and unaccepted `sent_tasks` have no ceiling.
- Expected: a setting (everyone / link only) and a lookup rate limit.
- Suggested fix: count `find_profile` and failed `request_friend` calls in a `hit_rate`-style counter; add `profiles.allow_requests`.

### SOC-13 · low · bug · `profiles` rows are fully readable by anyone with a pending request or share link, including `time_zone`
- [ ] Status: open
- Where: `profiles_read` -> `profile_visible` (friends.sql / shares.sql); `grant select ... on public.profiles to authenticated` is table-wide (sync.sql).
- Proven: reasoning only.
- What happens: a stranger sends a friend request (or redeems a share link), then selects the target's row: `time_zone`, `share_focus`, `handle_changed_at`, `created_at`, avatar, display name. Time zone is a location proxy. A share-link redeemer also reads the profile of every member of that share, including invited ones (`share_people` and `profile_visible` do not filter `status='active'`).
- Suggested fix: revoke table select on `profiles` and grant a column list (`id, handle, display_name, avatar`), or expose a view. Filter `share_people` to active members for non-owners.

### SOC-14 · low · bug · The 30-day handle-change limit can be bypassed
- [ ] Status: open
- Where: sync.sql `profiles_guard` plus `grant select, insert, update on public.profiles` (all columns).
- Proven: reasoning only.
- What happens: the trigger enforces 30 days from `old.handle_changed_at`, but the user may first `update profiles set handle_changed_at = null` (handle unchanged, so the guard does not touch it), then change the handle at once. This allows repeated renames to evade recognition, and old handles are free immediately, so a friend's former handle can be claimed by someone else.
- Suggested fix: restrict updatable columns (`grant update (handle, display_name, avatar, time_zone, share_focus)`), and keep old handles reserved for a while.

### SOC-15 · low · bug · `task_activity` edits are authorised against the new `task_id`, not the old one
- [ ] Status: open
- Where: `push_shared` task_activity branch (v121): `role_rank(row_role(o, 'task_activity', p_id, coalesce(cur,'{}') || f, me))`.
- Proven: reasoning only.
- What happens: a viewer of list B who is an editor of list A (same owner) can patch an activity row of B and supply the `task_id` of a task in A, because the role is computed from the merged data. They can rewrite or move B's activity history, and `actor_id` is stamped with the editor's id, falsifying attribution.
- Suggested fix: require editor on both `cur`'s list and the new `task_id`'s list.

### SOC-16 · low · bug · `refreshSocial` coalescing can leave Friends stale after an action
- [ ] Status: open
- Where: src/stores/social.ts `refreshSocial` (`refreshing ??= ...`) and `act`.
- Proven: reasoning only.
- What happens: if a refresh is in flight when the user accepts a request, `act` awaits that in-flight promise, which started before the change, and shows pre-action data. The ping from the action arrives while the same promise is pending and is also coalesced. The list stays stale until the next ping or the 3-minute timer, and the accepted request still shows.
- Suggested fix: keep a `dirty` flag: if `refreshSocial` is called while one is running, rerun once after it finishes.

### SOC-17 · low · bug · Edit guard allows edits to view-only shares until `useSocial.shares` loads
- [ ] Status: open
- Where: src/stores/social.ts `startSocial` `setEditGuard` -> `canEdit` (src/domain/shareAccess.ts): `shares` is `[]` before the first load, or when `serverBehind()`.
- Proven: reasoning only.
- What happens: for a short window after sign-in (or permanently on an old server) a viewer's edits to a shared list are accepted locally, refused by the server (`read_only`), then reverted with a Sync issue. The server stays authoritative, so this is a UX bug, not an access bypass.
- Suggested fix: treat a list with unknown share state (not `loaded`) as not editable.

### SOC-18 · low · bug · Published focus status is not cleared on sign-out; stale "focusing until" persists
- [ ] Status: open
- Where: src/features/friends/focusSession.ts `publishFocus` returns early when there is no account; `focus_status.ends_at` can sit for up to 12 hours.
- Proven: reasoning only.
- What happens: signing out (or a crash) during a published session leaves friends seeing that you are focusing until the planned end.
- Suggested fix: call `set_focus(null)` before sign-out, and expire with a heartbeat (`updated_at`) on read.

### SOC-19 · low · feature · Buddies cannot opt out, and habit names and progress are shared without the buddy's say
- [ ] Status: open
- Where: `set_buddies` / `buddy_habits` (social.sql): the owner enrols any friend, and the buddy then sees the habit name plus today's value and gets a Nudge button. There is no "leave" for the buddy and no notification.
- Suggested fix: a `buddy_decline` action.

### SOC-20 · low · feature · Share invitation spam
- [ ] Status: open
- Where: `invite_to_share` (shares.sql): no daily limit on invitations per friend, no cap on pending invitations per recipient, immediate re-invite after decline.
- Suggested fix: reuse the `friend_request_log` pattern for invitations.

### SOC-21 · low · feature · Slack OAuth callback has no `state` check or rate limit; webhook secret is in the URL path
- [ ] Status: open
- Where: supabase/functions/inbound/app.ts `slackOAuth`, and the `/webhook/<key>` route.
- What happens: the callback consumes any `code`, so an attacker can trigger Slack token exchanges at will, or trick an admin into completing an install the attacker started (the v1.2.2 spec adds `state`). Webhook secrets appear in Edge Function request logs because they are in the path. They are 192-bit random, so guessing is not a concern.
- Suggested fix: add `state` and `hit_rate('oauth:slack')` as the v1.2.2 spec plans; accept the secret in a header as well.

### SOC-22 · low · feature · Check hosted auth settings: OTP lifetime
- [ ] Status: open
- Where: supabase/config.toml has `otp_expiry = 3600`, `minimum_password_length = 6`, `enable_confirmations = false`. These are local-stack values; the live project's dashboard settings are not in the repo.
- What happens: a 6-digit email code valid for an hour is brute-forceable across many IPs if the live project uses the same value (verify limit is 30 per 5 minutes per IP).
- Suggested fix: 10 minute expiry on the live project.

## Verified OK
- Every table in `public` has RLS on and `revoke all ... from anon, authenticated`; direct grants are minimal and policies use `auth.uid()` (not a user-settable column): `friendships_own`, `blocks_own`, `invites_own`, `shares_members`, `share_members_members`, `sent_tasks_own` (column-limited so `payload` is hidden), `nudges_own`, `focus_status_read`, `social_pings` ("own pings"), `account_deletions_own`, `devices_own` (has `with check`), `sync_rows_own_read`. `profiles_own_update` has only USING, which Postgres reuses as the check, and `profiles_guard` pins `id`.
- All SECURITY DEFINER functions set `search_path = ''`. The DO-loop revokes strip PUBLIC/anon/authenticated from the private helpers (`befriend`, `is_friend`, `is_blocked`, `push_shared`, `ping`, `server_write`, `link_chat`, `hit_rate`, `send_task`, `insert_inbox_task`, `social_ping`); service-only ones are granted to `service_role` only.
- Share role checks are enforced in SQL (`push_shared`: `read_only`, `owner_only`, `bad_assignee`, `only_creator_moves_out`; `created_by`, `completed_by`, `actor_id` are server-stamped); viewers cannot create or edit; personal fields go to `task_personal`. `sync_pull` filters per row through `view_row`/`row_role`. Leaving or removal writes tombstones (`sync_gone`) and clears personal layers. Cross-namespace id collisions are refused (v121 "C2").
- Friend requests: the 20/day cap, 7-day decline memory, 200-friend cap, and an identical `no_such_account` error for blocked and missing accounts. `find_profile` and `request_friend` do not return email or any auth data. `remove_friend` and `block_account` clear `friendships`; `focus_visible`, `buddy_habits`, `nudge` and `send_task` all check `is_friend`.
- Invite codes are 10 chars from a 57-character alphabet via `gen_random_bytes` (about 58 bits), carry an expiry and `revoked_at`, and are created 50 a day at most; `redeem_invite` and `invite_info` check `is_blocked`.
- Realtime only publishes `devices`, `social_pings`, `focus_status`, `nudges`, `sent_tasks`, all RLS-filtered; `friendships` is deliberately not published (the migration explains the DELETE-event leak). Client SQL for remote rows only writes known local columns (`planApply` filters by `PRAGMA table_info`), so a hostile editor cannot inject identifiers.
- Edge Function `inbound`: Discord Ed25519 verification, Slack HMAC with a 5-minute window and constant-time compare, Telegram secret header check, digest secret check (empty secret rejected), private Telegram chats only, `/send` resolves the sender from the bearer token (not from the body), Slack `response_url` host-checked, webhook secrets 192-bit. Server secrets live in `server_secrets` and the function env, and `supabase/functions/.env` is git-ignored.
- Attachments: path-based `attachment_access` re-checks the live role (active members only) for read, write and delete; storage quota counts per uploader.
- No service_role key, bot token or signing secret in the repo; `.env` holds only the publishable key and project URL.
