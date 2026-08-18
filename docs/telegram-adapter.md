# Setting up the Telegram adapter

Same commands as Discord, delivered as Telegram messages instead of Discord DMs. [deploy-cloudflare.md](deploy-cloudflare.md) only gets mail as far as received and stored, so finish that first.

## What you need

- A cloned repo with `npm install` run in it.
- A deployed Worker (the same one from `deploy-cloudflare.md`, or a fresh one if you're not also running Discord).

## 1. Create a bot

Message [@BotFather](https://t.me/BotFather) on Telegram, `/newbot`, follow the prompts. You get back a **bot token**.

## 2. Pick a webhook secret

Not something Telegram gives you -- make one up yourself, any random string (`openssl rand -hex 32` works). Telegram echoes it back on every webhook call so a request can be confirmed as actually coming from Telegram, not just anyone who finds the URL.

## 3. One Worker or two?

Default to **one Worker** -- the same one already handling everything else. Add the Telegram route to it and you're done; nothing extra to deploy or keep in sync.

The only reason to split Telegram onto its *own* Worker (`src/telegram-worker.ts` / `wrangler.telegram.jsonc`) is if you're running **both** Discord and Telegram and specifically want them bundle-isolated from each other -- so a Discord-only change can't bloat what Telegram's Worker ships, and vice versa. If you're running Telegram alone, or don't care about that isolation, skip the split entirely.

### Single Worker (recommended default)

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Add `"telegram"` to `ADAPTERS` in `wrangler.jsonc`'s `vars` (comma-separated if Discord's there too: `"discord,telegram"`), then redeploy:

```bash
npx wrangler deploy
```

Your webhook path is `/telegram-webhook` on that same Worker.

### Split onto a second Worker (optional)

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN --config wrangler.telegram.jsonc
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --config wrangler.telegram.jsonc
npx wrangler deploy --config wrangler.telegram.jsonc
```

If your main Worker is in domain mode, also set `DISPOSABLE_DOMAIN` on this one to match:

```bash
npx wrangler secret put DISPOSABLE_DOMAIN --config wrangler.telegram.jsonc
```

Cloudflare doesn't share secrets between Workers, so this has to be kept in sync by hand. If you skip it, this Worker falls back to mail.tm mode regardless of what the main Worker does, since it has no way to know otherwise.

Your webhook path is `/webhook` on this second Worker, and it needs `TELEGRAM_BOT_TOKEN` set on the **main** Worker too (not just this one), so it can deliver inbound mail to Telegram users -- that part always runs on whichever Worker owns Email Routing and the cron, regardless of which Worker handles the webhook itself.

## 4. Point Telegram at your endpoint

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<your-worker-url>/telegram-webhook&secret_token=<your-webhook-secret>"
```

(`/webhook` instead of `/telegram-webhook` if you split onto a second Worker.) A successful response looks like `{"ok":true,"result":true,"description":"Webhook was set"}`.

## 5. Try it

Message your bot `/new`. Group chats are refused (commands only work in a private chat with the bot, so a reply can't be visible to anyone but the person who ran it -- Telegram has no equivalent to Discord's ephemeral replies).

## Commands

```
/new [expiry] [note]
/list
/note <address> [note]
/extend <address> [expiry]
/torch <address>
/remind [on|off]
```

No structured options the way Discord's slash commands have -- just plain text after the command. For `/new` and `/note`, a leading number is read as `expiry`; everything else is the note. For `/extend`, the address comes first and an optional trailing number is the new expiry. See [docs/discord-adapter.md](discord-adapter.md) for what each command actually does, rate limits, and expiry/note semantics -- identical on both platforms.
