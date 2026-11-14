# Setting up Connections (v1.4)

The bots and the webhook all run through one Edge Function, `inbound` (ADR 0008). Everything here is free-tier (D259). The app registrations belong to the project owner: create them yourself and keep the tokens out of the repo.

`<project>` below is the Supabase project ref (`tfuljwzkeylzwwzppdtv`). The function's base URL is `https://<project>.supabase.co/functions/v1/inbound`.

## 1. Deploy the database and the function

1. `supabase link --project-ref <project>`, then `supabase db push` to apply the v1.4 migrations.
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
     -d '[{"name":"task","description":"Momentum: add, today, done 2, help…","type":1,"integration_types":[0,1],"contexts":[0,1,2],"options":[{"name":"command","description":"e.g. add buy milk tomorrow","type":3,"required":true}]}]'
   ```

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

Settings → Connections → **Link a chat** shows a 6-digit code for 10 minutes. Send `/task link <code>` (Discord), `/momentum link <code>` (Slack) or `link <code>` (Telegram), then `help`. **Webhook** gives a secret URL that takes `POST {"text": "buy milk tomorrow"}`.

## Local testing

`supabase start`, then copy `supabase/functions/.env.example` to `supabase/functions/.env` (git-ignored) with test values and run `supabase functions serve`. `npm run test:server` runs the function in-process with signed fake requests and never calls the real platforms. To reach the local function from a real bot, expose port 54321 with a tunnel (for example `cloudflared tunnel --url http://127.0.0.1:54321`) and use that URL as `<base>`'s host.
