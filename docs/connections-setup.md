# Setting up Connections (v1.4)

The bots and the webhook all run through one Edge Function, `inbound` (ADR 0008). Everything here is free-tier (D259). The app registrations belong to the project owner: create them yourself and keep the tokens out of the repo.

`<project>` below is the Supabase project ref (`tfuljwzkeylzwwzppdtv`). The function's base URL is `https://<project>.supabase.co/functions/v1/inbound`.

## 1. Deploy the database and the function

1. `supabase link --project-ref <project>`, then `supabase db push` to apply the v1.4 and v1.2.1 migrations (the owner runs this; it changes the live server).
2. `supabase functions deploy inbound` (`config.toml` already sets `verify_jwt = false` for it: the platforms don't send Supabase tokens, and each adapter checks its own caller).
3. Pick a random Digest secret, e.g. `openssl rand -hex 24`. Then, in the SQL editor:
   ```sql
   insert into public.server_secrets (key, value) values
     ('inbound_url', 'https://<project>.supabase.co/functions/v1/inbound'),
     ('digest_secret', '<the digest secret>');
   ```
4. Copy `supabase/functions/.env.example` to a file outside the repo, fill it in as you go through steps 2–4 below, and load it with `supabase secrets set --env-file <that file>`.

## 2. Discord

1. https://discord.com/developers/applications → **New Application** → name it "Momentum".
2. **General Information:** copy the *Application ID* (`DISCORD_APP_ID`) and *Public Key* (`DISCORD_PUBLIC_KEY`). Set **Interactions Endpoint URL** to `<base>/discord` and save (Discord sends a signed ping; it saves only once the function answers it, so deploy first).
3. **Bot:** **Reset Token** and copy it (`DISCORD_BOT_TOKEN`). The Digest uses it to DM. Leave Message Content Intent off (the bot never reads messages).
4. **Installation:** tick **User Install** and **Guild Install**. Install link: Discord Provided Link. Scopes: `applications.commands` for both, plus `bot` for Guild Install.
5. Register the `/task` command once (replace the two values):
   ```bash
   curl -X PUT "https://discord.com/api/v10/applications/$DISCORD_APP_ID/commands" \
     -H "Authorization: Bot $DISCORD_BOT_TOKEN" -H "Content-Type: application/json" \
     -H "User-Agent: DiscordBot (https://github.com/prpiece/momentum, 1.2.1)" \
     -d '[{"name":"task","description":"Momentum: add, today, done 2, help…","type":1,"integration_types":[0,1],"contexts":[0,1,2],"options":[{"name":"command","description":"e.g. add buy milk tomorrow","type":3,"required":true}]}]'
   ```
   On Windows PowerShell, inline JSON gets split at the spaces (Discord answers "invalid JSON", code 50109), and `Invoke-RestMethod` is blocked by Discord's firewall ("internal network error", code 40333). Save the JSON to a file and send it with `curl.exe`:
   ```powershell
   '[{"name":"task","description":"Momentum: add, today, done 2, help","type":1,"integration_types":[0,1],"contexts":[0,1,2],"options":[{"name":"command","description":"e.g. add buy milk tomorrow","type":3,"required":true}]}]' | Set-Content -Encoding ascii "$env:TEMP\task-command.json"
   curl.exe -X PUT "https://discord.com/api/v10/applications/$env:DISCORD_APP_ID/commands" -H "Authorization: Bot $env:DISCORD_BOT_TOKEN" -H "Content-Type: application/json" -H "User-Agent: DiscordBot (https://github.com/prpiece/momentum, 1.2.1)" --data-binary "@$env:TEMP\task-command.json"
   ```
   Success prints the command back as JSON with `"name":"task"`.

## 3. Slack

1. https://api.slack.com/apps → **Create New App** → From scratch → "Momentum".
2. **Basic Information:** copy *Signing Secret* (`SLACK_SIGNING_SECRET`), *Client ID* (`SLACK_CLIENT_ID`) and *Client Secret* (`SLACK_CLIENT_SECRET`).
3. **Slash Commands** → Create: command `/momentum`, Request URL `<base>/slack`, short description "Add and see your tasks", usage hint `add buy milk tomorrow · today · help`.
4. **OAuth & Permissions:** Redirect URL `<base>/slack/oauth`. Bot token scopes: `commands`, `chat:write`, `im:write`.
5. **Manage Distribution:** turn on *Public Distribution* (no Marketplace listing needed) and use its **Add to Slack** link to install. The function stores each workspace's bot token for the Digest.

## 4. Telegram

1. Message [@BotFather](https://t.me/BotFather): `/newbot`, name it, copy the token (`TELEGRAM_BOT_TOKEN`).
2. Pick a random secret (`TELEGRAM_SECRET`, letters, digits, `_` and `-` only).
3. Point the bot at the function:
   ```bash
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" -d "url=<base>/telegram" -d "secret_token=$TELEGRAM_SECRET" -d 'allowed_updates=["message"]'
   ```
4. In BotFather, `/setprivacy` → Enable (the bot only answers in private chats anyway).

## 5. Keep-alive

In GitHub → Settings → Secrets and variables → Actions → **Variables**, add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (the same public values as `.env`). `.github/workflows/keepalive.yml` reads `server_meta` twice a week so the free project never pauses.

## Using it

Settings → Connections → **Link a chat** shows a 6-digit code for 10 minutes. Send `/task link <code>` (Discord), `/momentum link <code>` (Slack) or `link <code>` (Telegram), then `help`. **Webhook** gives a secret URL that takes `POST {"text": "buy milk tomorrow"}` (adds a task) or `POST {"command": "today"}` (runs a command; the reply is in `{"ok": true, "reply": "…"}`).

Every connection has the same commands (D288), the same ones the CLI has:

| Command | Does |
|---|---|
| `add <text>` | adds a task, with the app's quick-add tokens (`tomorrow 5pm`, `30m`, `by fri`, `!high`, `#tag`, `~List`) |
| `today` · `week` · `overdue` · `inbox` · `waiting` · `list <name>` · `search <text>` · `trash` | numbered listings (titles only; `search` shows done tasks last) |
| `view N` | one task's details and its full id |
| `update N <tokens>` | changes the date, deadline, duration, priority, list or tags (tags are added) |
| `done N` · `reopen N` · `snooze N <when>` · `move N <list>` · `deadline N <date>` | |
| `delete N` · `delete N with subtasks` · `restore N` | moves one task to the Trash, or brings it back (with its trashed parent) |
| `habits` · `habit <name>` | today's habits, or a check-in |
| `send @friend <text>` · `focus` | |
| `digest on <time>` · `digest off` · `unlink` | chats only |

`N` is a number from the connection's last listing (kept for an hour) or a task's full id (`view` shows it). Delete takes one task at a time, never a list of them, and refuses a task with subtasks unless you add `with subtasks`.

Each connection is **Add only** or **Full access**. Add only runs `add` (and `help`, `link`, `unlink`) and nothing that reads or changes other tasks; switching a chat to Add only turns its Digest off. Chats start with full access, the webhook starts add-only: anyone holding its URL can then only add tasks. The app sets this with `set_connection_permission(id, 'add' | 'full')` and `set_webhook_permission('add' | 'full')`, and reads it from `my_connections()` and `webhook_permission()`.

The server's `server_meta.schema_version` (D289) is 1 from the v1.2.1 migration on; every later migration bumps it.

## Local testing

`supabase start`, then copy `supabase/functions/.env.example` to `supabase/functions/.env` (git-ignored) with test values and run `supabase functions serve`. `npm run test:server` runs the function in-process with signed fake requests and never calls the real platforms. To reach the local function from a real bot, expose port 54321 with a tunnel (for example `cloudflared tunnel --url http://127.0.0.1:54321`) and use that URL as `<base>`'s host.
