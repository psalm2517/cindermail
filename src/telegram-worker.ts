import { createD1Executor } from "./storage/d1.ts";
import { handleTelegramWebhookRequest, type TelegramWebhookEnv } from "./adapters/telegram/webhook.ts";

// Only needed if you want Discord and Telegram bundle-isolated from each
// other -- otherwise src/worker.ts alone handles Telegram fine, webhook
// included, with no second Worker at all. See docs/telegram-adapter.md.
//
// If you do use this: it shares the same D1 database as src/worker.ts
// (owner_type distinguishes Discord- from Telegram-owned rows in the same
// table) but has no Email Routing and no cron -- src/worker.ts stays the
// only thing that processes inbound mail and runs cleanup, so there's
// exactly one place that could double-run the mail.tm poller or the daily
// cleanup. DISPOSABLE_DOMAIN is set independently here too, since
// Cloudflare doesn't share secrets across Workers -- keep the two in sync
// by hand.
export interface Env extends TelegramWebhookEnv {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("not found", { status: 404 });
    }

    return handleTelegramWebhookRequest(request, env, createD1Executor(env.DB));
  },
};
