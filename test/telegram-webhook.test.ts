import { test } from "node:test";
import assert from "node:assert/strict";
import { handleTelegramWebhookRequest, type TelegramWebhookEnv } from "../src/adapters/telegram/webhook.ts";
import { testDb } from "./helpers.ts";

const BASE_ENV: TelegramWebhookEnv = {
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
};

function webhookRequest(body: unknown, secretHeader?: string): Request {
  return new Request("https://example.com/telegram-webhook", {
    method: "POST",
    headers: secretHeader !== undefined ? { "X-Telegram-Bot-Api-Secret-Token": secretHeader } : {},
    body: JSON.stringify(body),
  });
}

test("rejects a request with the wrong secret token", async () => {
  const { db } = testDb();
  const req = webhookRequest({ message: { text: "/list", chat: { id: 1, type: "private" }, from: { id: 1 } } }, "wrong");
  const res = await handleTelegramWebhookRequest(req, BASE_ENV, db);
  assert.equal(res.status, 401);
});

test("rejects a request with no secret token header at all", async () => {
  const { db } = testDb();
  const req = webhookRequest({ message: { text: "/list", chat: { id: 1, type: "private" }, from: { id: 1 } } });
  const res = await handleTelegramWebhookRequest(req, BASE_ENV, db);
  assert.equal(res.status, 401);
});

test("accepts a request with the correct secret token and replies via the Telegram API", async (t) => {
  const { db } = testDb();
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
  );
  const req = webhookRequest(
    { message: { text: "/list", chat: { id: 1, type: "private" }, from: { id: 1 } } },
    "test-secret"
  );
  const res = await handleTelegramWebhookRequest(req, BASE_ENV, db);
  assert.equal(res.status, 200);
  assert.equal(fetchMock.mock.calls.length, 1);
  const [url] = fetchMock.mock.calls[0]?.arguments ?? [];
  assert.match(String(url), /\/bottest-token\/sendMessage$/);
});

test("rejects malformed JSON", async () => {
  const { db } = testDb();
  const req = new Request("https://example.com/telegram-webhook", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": "test-secret" },
    body: "not json",
  });
  const res = await handleTelegramWebhookRequest(req, BASE_ENV, db);
  assert.equal(res.status, 400);
});

test("fails closed (500) when this Worker has no Telegram config at all", async () => {
  const { db } = testDb();
  const req = webhookRequest({ message: { text: "/list", chat: { id: 1, type: "private" }, from: { id: 1 } } });
  const res = await handleTelegramWebhookRequest(req, {}, db);
  assert.equal(res.status, 500);
});
