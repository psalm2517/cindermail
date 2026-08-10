<div align="center">

# Cindermail 🔥

**Disposable email delivered where you already are.**

[![Release](https://img.shields.io/github/v/release/psalm2517/cindermail)](https://github.com/psalm2517/cindermail/releases)
[![License: Unlicense](https://img.shields.io/badge/License-Unlicense-blue.svg)](./LICENSE)
[![CI](https://github.com/psalm2517/cindermail/actions/workflows/ci.yml/badge.svg)](https://github.com/psalm2517/cindermail/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020.svg?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Stars](https://img.shields.io/github/stars/psalm2517/cindermail)](https://github.com/psalm2517/cindermail/stargazers)


</div>

---

Give out `x7k2p9qzrm@yourdomain.com` instead of your real address. Mail sent to it gets parsed and delivered to your Discord DMs. Torch it when you're done.

![Example delivery](docs/images/example-dm.png)

Addresses sit on a domain you own, so nothing flags them as disposable the way public temp-mail domains get flagged. Runs on Cloudflare's free tier: Email Routing receives, D1 stores, one Worker does the rest. Nothing to keep alive.

No domain? Leave one setting blank and it uses mail.tm's instead.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/psalm2517/cindermail)

Forks the repo, creates the database, deploys the Worker, prompts for your domain and Discord credentials. Blank domain means mail.tm mode.

It can't load the database schema or register the slash commands with Discord. Those are in [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md) and [docs/discord-adapter.md](docs/discord-adapter.md).

<details>
<summary>Prefer a local clone</summary>

```bash
git clone https://github.com/psalm2517/cindermail.git
cd Cindermail
npm install && npm run setup
```

The wizard asks the same questions and writes the same config. Use this if you'll be changing the code.

</details>

## Commands

| | |
|---|---|
| `/new [expiry] [note]` | A fresh address. Permanent unless given an expiry in days. |
| `/list` | Your addresses, with notes, expiry, and how many of your quota you're using. |
| `/extend <address> [expiry]` | Change when one expires. `expiry: 0` makes it permanent. |
| `/note <address> [note]` | Label one. Blank clears it. |
| `/remind [enabled]` | Opt in to a DM a day before an address expires. |
| `/torch <address>` | Kill it. |

Replies are ephemeral, visible only to whoever ran the command. Details in [docs/discord-adapter.md](docs/discord-adapter.md).

## How it works

1. `/new` mints a random address owned by whoever ran it.
2. Give it out. Mail sent there comes back to you, not to wherever you used it.
3. Mail arrives, the Worker looks up the owner. Unknown, expired or torched addresses are dropped: no bounce, nothing logged.
4. Otherwise it's parsed (HTML to text, links intact, attachments forwarded) and DM'd to you.

A daily cron deletes expired and torched addresses, clears stale rate-limit rows, and sends expiry reminders.

The Worker root serves a status page with running totals, also available as JSON at `/counters`. Counts only, no addresses or owners.

## Limits

- 5 active addresses per owner, configurable.
- Message bodies cap at 1500 characters inline; longer is attached as `message.txt`.
- Inbound HTML caps at 256KB before parsing. Parsing cost scales quadratically, and anyone who learns an address can send to it.
- Attachments forward up to 25MB combined per email. Anything over budget is dropped with a note, not the whole batch.

Code layout and tests: [docs/architecture.md](docs/architecture.md). Every setting: [docs/configuration.md](docs/configuration.md).

## Under consideration (contingent on demand)

- Telegram delivery adapter
- Slack delivery adapter
- Publicly hosted instance

## AI disclosure

This project was built with AI assistance, directed by me.

## License

Unlicense. See [LICENSE](./LICENSE).

<div align="center">

[![Built with Cloudflare](https://workers.cloudflare.com/built-with-cloudflare.svg)](https://cloudflare.com)

</div>
