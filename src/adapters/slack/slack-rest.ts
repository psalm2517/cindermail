const API_BASE = "https://slack.com/api";

export interface SlackFile {
  filename: string;
  contentType: string;
  content: ArrayBuffer;
}

export class SlackApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function slackApi(botToken: string, method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_BASE}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!response.ok || !data.ok) {
    throw new SlackApiError(response.status, `Slack API ${method} failed: ${data.error ?? response.status}`);
  }
  return data;
}

// A user ID works directly as `channel` on chat.postMessage -- Slack opens
// the DM itself, no separate conversations.open call needed first, same
// simplicity as Telegram's chat_id.
export async function postMessage(botToken: string, userId: string, text: string): Promise<void> {
  await slackApi(botToken, "chat.postMessage", { channel: userId, text, unfurl_links: false });
}

// files.upload is deprecated; this is the current three-step flow: get an
// upload URL, PUT the bytes to it, then complete the upload and share it
// into the DM. `channel_id` on completeUploadExternal accepts a user ID the
// same way chat.postMessage's `channel` does.
export async function uploadFile(botToken: string, userId: string, file: SlackFile): Promise<void> {
  const params = new URLSearchParams({ filename: file.filename, length: String(file.content.byteLength) });
  const urlResponse = await fetch(`${API_BASE}/files.getUploadURLExternal?${params}`, {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  const urlData = (await urlResponse.json().catch(() => ({}))) as {
    ok?: boolean;
    upload_url?: string;
    file_id?: string;
    error?: string;
  };
  if (!urlResponse.ok || !urlData.ok || !urlData.upload_url || !urlData.file_id) {
    throw new SlackApiError(
      urlResponse.status,
      `Slack API files.getUploadURLExternal failed: ${urlData.error ?? urlResponse.status}`
    );
  }

  const uploadResponse = await fetch(urlData.upload_url, {
    method: "POST",
    body: new Blob([file.content], { type: file.contentType }),
  });
  if (!uploadResponse.ok) {
    throw new SlackApiError(uploadResponse.status, `Slack file upload failed: ${uploadResponse.status}`);
  }

  await slackApi(botToken, "files.completeUploadExternal", {
    files: [{ id: urlData.file_id, title: file.filename }],
    channel_id: userId,
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// v0 signing scheme: HMAC-SHA256 over "v0:<timestamp>:<raw body>", keyed by
// the signing secret. The timestamp check guards against a captured request
// being replayed later, same purpose as Discord/Telegram's own freshness or
// shared-secret checks, just Slack's specific mechanism for it.
export async function verifySlackSignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string,
  signature: string
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 60 * 5) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v0:${timestamp}:${rawBody}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");

  return timingSafeEqual(`v0=${hex}`, signature);
}
