import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { handleSlackCommandRequest, type SlackWebhookEnv } from "../src/adapters/slack/webhook.ts";
import { testDb } from "./helpers.ts";

const SIGNING_SECRET = "test-signing-secret";
const BASE_ENV: SlackWebhookEnv = { SLACK_SIGNING_SECRET: SIGNING_SECRET };

function sign(body: string, timestamp: string, secret: string = SIGNING_SECRET): string {
  const base = `v0:${timestamp}:${body}`;
  return `v0=${createHmac("sha256", secret).update(base).digest("hex")}`;
}

function slashRequest(
  form: Record<string, string>,
  opts: { timestamp?: string; signature?: string; skipSignature?: boolean } = {}
): Request {
  const body = new URLSearchParams(form).toString();
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (!opts.skipSignature) {
    headers["X-Slack-Request-Timestamp"] = timestamp;
    headers["X-Slack-Signature"] = opts.signature ?? sign(body, timestamp);
  }
  return new Request("https://example.com/slack/commands", { method: "POST", headers, body });
}

test("rejects a request with a bad signature", async () => {
  const { db } = testDb();
  const req = slashRequest({ command: "/cm-list", text: "", user_id: "U1" }, { signature: "v0=deadbeef" });
  const res = await handleSlackCommandRequest(req, BASE_ENV, db);
  assert.equal(res.status, 401);
});

test("rejects a request with no signature headers at all", async () => {
  const { db } = testDb();
  const req = slashRequest({ command: "/cm-list", text: "", user_id: "U1" }, { skipSignature: true });
  const res = await handleSlackCommandRequest(req, BASE_ENV, db);
  assert.equal(res.status, 401);
});

test("rejects a stale timestamp (replay protection)", async () => {
  const { db } = testDb();
  const staleTimestamp = String(Math.floor(Date.now() / 1000) - 60 * 10);
  const req = slashRequest({ command: "/cm-list", text: "", user_id: "U1" }, { timestamp: staleTimestamp });
  const res = await handleSlackCommandRequest(req, BASE_ENV, db);
  assert.equal(res.status, 401);
});

test("accepts a correctly signed request and replies ephemerally", async () => {
  const { db } = testDb();
  const req = slashRequest({ command: "/cm-list", text: "", user_id: "U1" });
  const res = await handleSlackCommandRequest(req, BASE_ENV, db);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { response_type: string; text: string };
  assert.equal(body.response_type, "ephemeral");
  assert.match(body.text, /active addresses/);
});

test("rejects a payload missing command or user_id", async () => {
  const { db } = testDb();
  const req = slashRequest({ command: "", text: "", user_id: "" });
  const res = await handleSlackCommandRequest(req, BASE_ENV, db);
  assert.equal(res.status, 400);
});

test("fails closed (500) when this Worker has no Slack config at all", async () => {
  const { db } = testDb();
  const req = slashRequest({ command: "/cm-list", text: "", user_id: "U1" });
  const res = await handleSlackCommandRequest(req, {}, db);
  assert.equal(res.status, 500);
});
