# Google Calendar and Outlook sync: setup

Two-way calendar sync runs in one Edge Function, `calendar` (PLAN D345). The OAuth apps belong to the project owner: create them yourself and keep every secret out of the repo. Nothing here has a value filled in on purpose.

`<project-ref>` below is the Supabase project ref (Dashboard → Project Settings → General; this repo's production project is `tfuljwzkeylzwwzppdtv`). The function's base URL is

```
https://<project-ref>.supabase.co/functions/v1/calendar
```

and the only redirect URIs either provider may use are `…/calendar/callback/google` and `…/calendar/callback/microsoft`.

## 1. Google Cloud

1. Go to https://console.cloud.google.com/ and create a project (top bar → project picker → **New project**, e.g. "Momentum").
2. **APIs & Services → Library**: search **Google Calendar API** and click **Enable**.
3. **Google Auth Platform** (older consoles: **APIs & Services → OAuth consent screen**) → **Get started**:
   - App name "Momentum", your support email, **Audience: External**, your contact email. Create.
   - **Branding**: add the app's home page and privacy policy (`https://prpiece.github.io/momentum/privacy.html`). Authorized domains can wait until you verify the app with a domain of your own.
   - **Audience**: under **Test users**, add the Google accounts that may connect while the app is in testing (up to 100).
   - **Data access → Add or remove scopes**: add `https://www.googleapis.com/auth/calendar` (Google lists it as sensitive). Save.
4. **Clients → Create client** (older: **Credentials → Create credentials → OAuth client ID**):
   - Application type **Web application**, name "Momentum calendar function".
   - **Authorized redirect URIs → Add URI**: `https://<project-ref>.supabase.co/functions/v1/calendar/callback/google`
   - No JavaScript origins are needed. Create, then copy the **Client ID** and **Client secret** (the secret is shown once in newer consoles; download the JSON).

**Verification.** While the app's publishing status is *Testing*, only the listed test users can connect, and Google expires their grants after 7 days (they reconnect from Settings). To open it to everyone, click **Publish app**; because the calendar scope is sensitive, Google then requires app verification (a verified domain, a privacy policy that says what the server stores, a demo video) before more than 100 users can grant it, and shows an "unverified app" warning until then.

## 2. Microsoft Entra (Outlook, Microsoft 365, Outlook.com)

1. Go to https://entra.microsoft.com/ (any Microsoft account works; a personal account gets a default directory) → **Identity → Applications → App registrations → New registration**.
   - Name "Momentum".
   - **Supported account types: Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)**.
   - **Redirect URI**: platform **Web**, `https://<project-ref>.supabase.co/functions/v1/calendar/callback/microsoft`.
   - Register. Copy the **Application (client) ID** from the Overview page.
2. **API permissions → Add a permission → Microsoft Graph → Delegated permissions**: tick `Calendars.ReadWrite`, `offline_access` and `User.Read` (already there by default). Add permissions. No admin consent is needed for these; each user consents when they connect. (A work tenant that blocks user consent needs its admin to click **Grant admin consent**.)
3. **Certificates & secrets → Client secrets → New client secret**: a description and an expiry (up to 24 months; put the renewal in your calendar). Copy the secret's **Value** (not the Secret ID); it is shown once.
4. Optional: **Branding & properties** → publisher domain and privacy link. Unverified multitenant apps show an "unverified" label on the consent screen; publisher verification (a Microsoft Partner Network id) removes it.

## 3. Secrets and deploy

Generate the three random secrets (any machine with OpenSSL or Node):

```
openssl rand -base64 32   # CALENDAR_TOKEN_KEY: exactly 32 random bytes, base64
openssl rand -hex 32      # CALENDAR_STATE_SECRET
openssl rand -hex 32      # CALENDAR_CRON_SECRET
# or: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Set them and the app credentials on the project (from the repo root, logged in with `npx supabase login`, linked with `npx supabase link --project-ref <project-ref>`):

```
npx supabase secrets set \
  GOOGLE_CLIENT_ID=<google client id> \
  GOOGLE_CLIENT_SECRET=<google client secret> \
  MS_CLIENT_ID=<application (client) id> \
  MS_CLIENT_SECRET=<client secret value> \
  MS_TENANT=common \
  CALENDAR_TOKEN_KEY=<base64 of 32 bytes> \
  CALENDAR_STATE_SECRET=<hex> \
  CALENDAR_CRON_SECRET=<hex>
```

- Leave out either provider's pair to keep it switched off: its Connect button then reports that it isn't set up.
- `MS_TENANT` is `common` for work and personal accounts; use a tenant id to allow one organization only.
- Never change `CALENDAR_TOKEN_KEY` once accounts are connected: the stored grants can't be opened with another key, and every user would have to reconnect.
- `CALENDAR_PUBLIC_URL` is optional and only for a local stack, where `SUPABASE_URL` is an internal address: set it to the function's public base URL.

Apply the migration and deploy the function:

```
npx supabase db push
npx supabase functions deploy calendar
```

`supabase/config.toml` already sets `verify_jwt = false` for `calendar` (the OAuth redirects come from a browser without a Supabase token; the app's calls are checked inside the function). If you deploy from somewhere that ignores the config, add `--no-verify-jwt`.

## 4. The 10-minute background sync (pg_cron)

Migration `20261117000000_calendar_sync.sql` schedules `calendar-sync` every 10 minutes with pg_cron and pg_net (both already enabled for the Digest). It does nothing until the function's address and the cron secret are in `server_secrets`. In the SQL editor:

```sql
insert into public.server_secrets (key, value) values
  ('calendar_url', 'https://<project-ref>.supabase.co/functions/v1/calendar'),
  ('calendar_cron_secret', '<the same CALENDAR_CRON_SECRET>')
on conflict (key) do update set value = excluded.value;
```

Each run syncs the 25 accounts that synced longest ago. Check it with `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'calendar-sync') order by start_time desc limit 5;` and the function's logs (Dashboard → Edge Functions → calendar → Logs; tokens never appear there). To change the interval: `select cron.alter_job((select jobid from cron.job where jobname = 'calendar-sync'), schedule := '*/5 * * * *');`

## 5. Try it

1. Desktop app, signed in → Settings → Connections → Calendars → **Connect** next to Google Calendar. The browser opens Google's consent screen; allow it, and the tab says it's connected.
2. Back in Momentum the row shows the account. Tick the calendars to show and pick where new Momentum events go ("Momentum only" sends none).
3. Within a few seconds (or **Sync now**) the events appear in the calendar with the calendar's colour and a small G or O mark, on the phone too after its next sync.
4. Edit or delete one in Momentum: it changes in Google about 3 seconds later. Edit one in Google: it changes in Momentum on the next run (Sync now, or within 10 minutes). If both changed it, Google's version wins.

The privacy page should say that, for a connected calendar, the server stores the account's email, an encrypted refresh token, the chosen calendars and sync cursors, and the calendar's events as part of the user's synced records (D268).
