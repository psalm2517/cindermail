import { createAddress } from "./core/db.ts";
import { buildCommandConfig } from "./core/config.ts";
import { createD1Executor } from "./storage/d1.ts";
import { createMailtmAddress } from "./receivers/mailtm/address.ts";
import { sendMessage } from "./adapters/telegram/telegram-rest.ts";
import { handleUpdate, type TelegramUpdate } from "./adapters/telegram/commands.ts";

// A separate Worker from src/worker.ts on purpose: it owns the Telegram
// webhook, nothing else. It shares the same D1 database (owner_type
// distinguishes Discord- from Telegram-owned rows in the same table) but
// has no Email Routing and no cron -- src/worker.ts stays the only thing
// that processes inbound mail and runs cleanup, so there's exactly one
// place that could double-run the mail.tm poller or the daily cleanup.
// This Worker only needs DISPOSABLE_DOMAIN so /new creates addresses the
// same way src/worker.ts does; it's set independently here since Cloudflare
// doesn't share secrets across Workers, so keep the two in sync by hand.
export interface Env {
  DB: D1Database;
  DISPOSABLE_DOMAIN?: string;
  TELEGRAM_BOT_TOKEN: string;
  // Telegram echoes this back on every webhook call so a request can be
  // confirmed as actually coming from Telegram, not just anyone who finds
  // the URL. Set with `wrangler secret put TELEGRAM_WEBHOOK_SECRET`, then
  // pass the same value as setWebhook's own secret_token parameter.
  TELEGRAM_WEBHOOK_SECRET: string;
  [key: string]: unknown;
}

function usesOwnDomain(env: Env): boolean {
  return !!env.DISPOSABLE_DOMAIN && env.DISPOSABLE_DOMAIN.trim() !== "";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("not found", { status: 404 });
    }

    const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("invalid secret token", { status: 401 });
    }

    let update: TelegramUpdate;
    try {
      update = (await request.json()) as TelegramUpdate;
    } catch {
      return new Response("malformed update", { status: 400 });
    }

    const db = createD1Executor(env.DB);
    const config = buildCommandConfig(env as Record<string, string | undefined>);
    const domain = env.DISPOSABLE_DOMAIN;
    const createAddressFn = usesOwnDomain(env)
      ? (
          executor: ReturnType<typeof createD1Executor>,
          owner: { type: string; id: string },
          ttl: number,
          permanent: boolean,
          note: string | null
        ) => createAddress(executor, owner, domain as string, ttl, permanent, note)
      : createMailtmAddress;

    const reply = await handleUpdate(update, db, createAddressFn, config);
    if (reply) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, reply.chatId, reply.text);
    }

    // Telegram retries a webhook that doesn't return 200 promptly. The
    // reply is already sent above via a direct API call, so this response
    // body is just an acknowledgement, not the reply itself.
    return new Response("ok");
  },
};
