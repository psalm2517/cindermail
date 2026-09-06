# Setting up the Telegram adapter

Mail gets delivered as a Telegram message to whoever owns the address. [deploy-cloudflare.md](deploy-cloudflare.md) only gets mail as far as received and stored, so finish that first.

## What you need

- A cloned repo with `npm install` run in it.
- A deployed Worker (the same one from `deploy-cloudflare.md`, or a fresh one if this is the only adapter you're running).

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

Message your bot `/new`. Group chats are refused: commands only work in a private chat with the bot, since Telegram has no way to send a reply that's visible only to the person who ran the command, the way a reply in a private chat already is for everyone else in it.

## Commands

Plain text after the command, no structured options, everything is just typed as one string:

| Command | What it does | Rate limit |
|---|---|---|
| `/new [expiry] [note]` | Creates an address. Permanent unless `expiry` is given. | 1 per 30s |
| `/list` | Your addresses, notes, and expiry. | 15 per 60s |
| `/extend <address> [expiry]` | Changes when an address expires. | 15 per 60s |
| `/note <address> [note]` | Labels an address. Blank clears it. | 15 per 60s |
| `/torch <address>` | Revokes an address. | 15 per 60s |
| `/remind [on\|off]` | Expiry reminder messages. Blank shows the current setting. | 15 per 60s |

For `/new` and `/note`, a leading number is read as `expiry`; everything else is the note. For `/extend`, the address comes first and an optional trailing number is the new expiry:

```
/new                              permanent, no note
/new 7                            expires in 7 days
/new 7 netflix signup             expires in 7 days, noted
/new netflix signup               permanent (no leading number), noted

/extend x@you.com                 10 days from now
/extend x@you.com 5               5 days from now
/extend x@you.com 0               permanent
```

`expiry` is in **days** on both `/new` and `/extend`, `0` meaning permanent. One asymmetry: bare `/new` is permanent, bare `/extend` uses the 10 day default, since `/extend` should do what its name says. `/extend` also sets expiry relative to now rather than adding to what's left: an address with 8 days left extended by `5` has 5 days, not 13.

Permanent addresses still count against your active-address limit, and show as `permanent` in `/list` rather than a countdown. Cleanup skips them, so `/torch` is what ends one.

## Notes

A random local part tells you nothing about what you used it for. A note is an optional label, up to 80 characters, shown in `/list`, visible only to the address's owner:

```
/new 0 netflix trial
/note x7k2p9qzrm@you.com bank alerts
/note x7k2p9qzrm@you.com              clears it
```

## Expiry reminders

Off until asked for:

```
/remind on      message about a day before an address expires
/remind off     stop
/remind         current setting
```

One message covering everything of yours expiring soon, with notes, so you can `/extend` what you still need. It rides the daily cleanup cron, so it lands 24 to 48 hours ahead rather than exactly a day; an address living under about two days never gets one, since no run sees it with a day still left: `/new 1` won't warn. `/extend` re-arms the reminder against the new expiry.

Defaults for all of the above are configurable, see [configuration.md](configuration.md).
