# Architecture

One Cloudflare Worker by default. Email Routing (or mail.tm) receives, D1 stores, Discord and/or Telegram deliver.

```
src/worker.ts             The main entrypoint. fetch() serves Discord
                          interactions, the Telegram webhook (optional, see
                          below), and the status page. email() takes inbound
                          mail from Email Routing. scheduled() runs the
                          mail.tm poll and the daily cleanup. Picks domain vs
                          mail.tm mode from whether DISPOSABLE_DOMAIN is set.
src/telegram-worker.ts    An optional second entrypoint, only relevant if
                          you're running Discord and Telegram together and
                          want them bundle-isolated from each other. See
                          docs/telegram-adapter.md. Owns only the Telegram
                          webhook -- no Email Routing, no cron, so there's
                          exactly one place (src/worker.ts) that could ever
                          double-run the mail.tm poller or daily cleanup.
src/core/                 Address CRUD, rate limiting, dispatch, MIME
                          parsing, plus command/config logic shared by every
                          chat-platform adapter (core/commands.ts,
                          core/config.ts, core/html-to-text.ts). Doesn't
                          import from adapters/ or storage/.
src/core/storage.ts       SqlExecutor: the run/first/all interface core runs
                          SQL against, so core has no D1 types in it.
src/storage/d1.ts         The SqlExecutor implementation for D1.
src/adapters/             Delivery adapters. discord/ and telegram/ both
                          ship built in.
src/receivers/mailtm/     mail.tm's API client, the poller, and its cleanup
                          (which deletes the remote mailbox before dropping
                          the row). Used for any mail.tm-backed address
                          regardless of which Worker created it.
src/counter-page.ts       The status page's HTML, inlined, no external
                          assets.
```

## Two modes, one Worker

`DISPOSABLE_DOMAIN` decides how addresses get created on whichever Worker you're looking at:

- **Set.** Addresses are generated on your domain. Cloudflare Email Routing's catch-all rule invokes `email()`.
- **Empty.** `createMailtmAddress` provisions a real mailbox on mail.tm per `/new`.

The poll cron and daily cleanup run unconditionally on `src/worker.ts` regardless of this setting, since the database can hold a mix of both kinds of address at once, for example if Telegram is split onto its own Worker independently running in mail.tm mode while the main Worker is in domain mode. Both `pollOnce` and `runMailtmCleanup` already no-op cheaply for rows that aren't mail.tm-backed, so there's no benefit to gating either call on this Worker's own mode.

Everything else, commands, storage, delivery, cleanup, the status page, is identical between modes.

## Tests

```bash
npm test
```

Node's built-in runner against a real in-memory SQLite database. No dependencies, no mocks: D1 speaks the same dialect, and these run through the same `SqlExecutor` interface `src/storage/d1.ts` implements.

Covers command semantics, mail rendering, counters, expiry reminders, and that `schema.sql` still agrees with the migration chain. Several cases exist because a failure there once broke mail delivery: a missing `counters` table, and anything thrown by a reminder taking out the cleanup that runs alongside it.

## Extending it

**Delivery adapter.** Implement `MailAdapter` in `src/core/types.ts`: a `name`, a `deliver(owner, mail)` for forwarded email, and a `notify(owner, message)` for plain messages from the bot itself (expiry reminders). Both return `{ success, error? }` and never throw. Register it in `buildAdapters()` in `src/worker.ts` -- this part always lives there, since that's the only Worker that ever processes inbound mail.

If the platform also needs inbound commands (`/new`, `/list`, etc., not just outbound delivery), that's a separate piece: parse whatever shape that platform's messages arrive in, reuse the shared logic in `src/core/commands.ts` and `src/core/config.ts` rather than reimplementing expiry/note parsing, and call the same `core/db.ts` functions Discord and Telegram both use. Whether that handler needs its own Worker (like `src/telegram-worker.ts`) or can just add a route to `src/worker.ts`'s `fetch()` depends on whether you want it bundle-isolated from the other adapters -- see `src/adapters/telegram/webhook.ts` for the pattern of a handler shared between both options.

**Storage backend.** Implement `SqlExecutor` in `src/core/storage.ts`. Call `handleInboundEmail({ to, from, raw }, db, dispatcher)` from `core/email.ts` for each piece of mail. `raw` takes a `Buffer`, `ReadableStream`, or string, whatever `postal-mime` accepts.
