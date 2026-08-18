# Configuration reference

Everything is read from the Worker's environment, so anything below works either as a secret (`wrangler secret put NAME`) or as a plain `vars` entry in `wrangler.jsonc`.

Use secrets for anything specific to your deployment. `wrangler.jsonc` is committed, so values there ship to everyone who clones it, and plaintext dashboard variables get overwritten on the next deploy by whatever that file declares. Secrets stay out of the repo and survive deploys. Only `ADAPTERS` sits in `vars`, because it's the same everywhere.

| Variable | Required | Default | What it does |
|---|---|---|---|
| `DISCORD_TOKEN` | if `ADAPTERS` includes `discord` | | Bot token. |
| `DISCORD_PUBLIC_KEY` | if `ADAPTERS` includes `discord` | | Verifies that interactions actually came from Discord. |
| `DISCORD_APPLICATION_ID` | if `ADAPTERS` includes `discord` | | Used by `register-commands.ts`. |
| `TELEGRAM_BOT_TOKEN` | if `ADAPTERS` includes `telegram` | | Bot token, from @BotFather. |
| `TELEGRAM_WEBHOOK_SECRET` | only if this Worker handles the Telegram webhook itself | | One you make up, not one Telegram gives you. Verifies a webhook call actually came from Telegram. Unused if you split Telegram onto its own Worker via `wrangler.telegram.jsonc` and it's set there instead. See [telegram-adapter.md](telegram-adapter.md). |
| `DISPOSABLE_DOMAIN` | no | unset | Domain addresses are generated on. Unset means mail.tm mode: addresses on mail.tm's domain, no domain of your own needed. Set independently per Worker if you're running Telegram split onto its own Worker; Cloudflare doesn't share secrets between Workers. |
| `ADAPTERS` | no | `discord` | Comma separated list of enabled delivery adapters: `discord`, `telegram`, or both. |
| `MAX_ACTIVE_ADDRESSES` | no | `5` | Addresses one owner can hold at once. |
| `ADDRESS_TTL_SECONDS` | no | `864000` (10 days) | What a bare `/extend` uses. `/new` is permanent by default and ignores this unless given an explicit `expiry`. |
| `RATE_LIMIT_<CMD>_WINDOW_SECONDS` | no | see below | Window length for a command's rate limit. `<CMD>` is `NEW`, `LIST`, `EXTEND`, `TORCH`, `NOTE` or `REMIND`. |
| `RATE_LIMIT_<CMD>_MAX` | no | see below | Calls allowed per window. `0` disables that command's limit. |

Rate limit defaults: `NEW` is 1 call per 30 seconds, everything else 15 per 60.

They're there to stop a deployment other people can reach getting hammered, not to protect you from yourself. Scoped per owner rather than shared, so running this for yourself you'll likely never hit them. Set every `RATE_LIMIT_*_MAX` to `0` to remove them.

## Cron triggers

In `wrangler.jsonc` under `triggers.crons`, not variables:

| Schedule | What it does |
|---|---|
| `0 3 * * *` | Daily: deletes expired and torched addresses, clears stale rate-limit rows, sends expiry reminders, and deletes the remote mailbox behind any dropped mail.tm-backed address, regardless of whether this Worker's own `DISPOSABLE_DOMAIN` is set. |
| `*/1 * * * *` | Polls mail.tm for any mail.tm-backed address in the database, again regardless of this Worker's own `DISPOSABLE_DOMAIN`. Costs one cheap query and no-ops when there's nothing mail.tm-backed to find. |

Both run unconditionally rather than being gated on this Worker's own mode: a mail.tm-backed address can exist in the database even when this Worker itself is in domain mode, if another adapter (e.g. Telegram split onto its own Worker) independently created it in mail.tm mode. Gating on the wrong Worker's setting used to mean those addresses were silently never polled or cleaned up.

The one minute floor on cron triggers is why mail.tm mode averages about 30 seconds to deliver.

Times are UTC. The daily one sends reminder messages, so its hour decides when people get notified.
