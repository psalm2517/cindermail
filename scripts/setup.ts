import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { printBanner } from "../src/banner.ts";

const rl = createInterface({ input: stdin, output: stdout });

async function ask(question: string, fallback = ""): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || fallback;
}

async function confirm(question: string): Promise<boolean> {
  const answer = (await rl.question(`${question} [y/N]: `)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

async function writeGuarded(path: string, content: string): Promise<boolean> {
  if (existsSync(path) && !(await confirm(`${path} already exists. Overwrite it?`))) {
    console.log(`Left ${path} alone. Nothing written.`);
    return false;
  }
  writeFileSync(path, content);
  console.log(`Wrote ${path}`);
  return true;
}

// Writes to a live Worker, so it confirms first and names the target. Two
// reasons that matters: `wrangler secret put` silently CREATES a Worker if
// the name in wrangler.jsonc doesn't exist yet, and if it does exist this
// overwrites whatever config it's currently running on.
async function putSecrets(secrets: Record<string, string>): Promise<void> {
  const names = Object.keys(secrets);
  if (names.length === 0) {
    return;
  }

  const worker = readFileSync("wrangler.jsonc", "utf8").match(/"name":\s*"([^"]*)"/)?.[1] ?? "this Worker";
  console.log(`\nReady to set ${names.join(", ")} on the Worker "${worker}".`);
  console.log("This writes to Cloudflare, creating that Worker if it doesn't exist yet.");
  if (!(await confirm("Go ahead?"))) {
    console.log("Skipped. Set them yourself with:");
    for (const name of names) {
      console.log(`  npx wrangler secret put ${name}`);
    }
    return;
  }

  for (const [name, value] of Object.entries(secrets)) {
    try {
      // Piped rather than prompted: the values were collected above already.
      // wrangler reads from stdin when it isn't a TTY.
      execFileSync("npx", ["wrangler", "secret", "put", name], { input: value, stdio: ["pipe", "ignore", "inherit"] });
      console.log(`Set ${name}`);
    } catch {
      console.log(`Couldn't set ${name}. Run this yourself later:`);
      console.log(`  npx wrangler secret put ${name}`);
    }
  }
}

// Secrets go through `wrangler secret put`, which prompts for the value
// itself, so nothing sensitive is read here or written to any file.
async function putDiscordSecrets(): Promise<void> {
  console.log("\nDiscord credentials, from discord.com/developers/applications.");
  console.log("wrangler will prompt for each value. They're stored encrypted by");
  console.log("Cloudflare, never written to a file in this repo.\n");

  for (const name of ["DISCORD_TOKEN", "DISCORD_PUBLIC_KEY", "DISCORD_APPLICATION_ID"]) {
    try {
      execFileSync("npx", ["wrangler", "secret", "put", name], { stdio: "inherit" });
    } catch {
      console.log(`\nCouldn't set ${name}. Run this yourself later:`);
      console.log(`  npx wrangler secret put ${name}`);
    }
  }
}

async function askLimits(): Promise<Record<string, string>> {
  if (!(await confirm("\nCustomize limits (active addresses per owner, address expiry)?"))) {
    return {};
  }
  const maxActive = await ask("  Max active addresses per owner", "5");
  const ttlDays = await ask("  Address expiry, in days", "10");
  console.log("  Rate limits (per-command call caps) aren't prompted here, the");
  console.log("  defaults are fine for almost everyone. See docs/configuration.md");
  console.log("  if you want to change those.");

  const result: Record<string, string> = {};
  if (maxActive) {
    result.MAX_ACTIVE_ADDRESSES = maxActive;
  }
  if (ttlDays) {
    result.ADDRESS_TTL_SECONDS = String(Number(ttlDays) * 86400);
  }
  return result;
}

async function setupCloudflare(mode: "domain" | "mailtm"): Promise<void> {
  try {
    execFileSync("npx", ["wrangler", "--version"], { stdio: "ignore" });
  } catch {
    console.log("\nwrangler isn't available. Install it, then run this again:");
    console.log("  npm install -g wrangler");
    console.log("It needs Node.js 22 or newer.");
    return;
  }

  // wrangler.jsonc is committed (Workers Builds clones the repo and needs
  // the D1 binding present at build time), so this edits it in place rather
  // than writing a second config file. Wrangler picks .jsonc over .toml
  // silently, so a stray wrangler.toml would just be ignored.
  let content = readFileSync("wrangler.jsonc", "utf8");

  // Deployment-specific values go to secrets rather than into the committed
  // file, so nothing here ends up carrying your domain into someone else's
  // clone. Secrets also survive deploys, which plaintext dashboard variables
  // don't.
  const secrets: Record<string, string> = {};

  if (mode === "domain") {
    const domain = await ask("\nDomain addresses get generated on (e.g. yourdomain.com)");
    if (domain) {
      secrets.DISPOSABLE_DOMAIN = domain;
    }
  }
  // mail.tm mode wants DISPOSABLE_DOMAIN unset, which is already the default,
  // so there's nothing to write for it.

  Object.assign(secrets, await askLimits());

  if (await confirm("\nRun `wrangler d1 create cinderbox` now?")) {
    try {
      const output = execFileSync("npx", ["wrangler", "d1", "create", "cinderbox"], { encoding: "utf8" });
      const id = output.match(/database_id\s*[=:]\s*"?([0-9a-f-]{36})"?/i)?.[1];
      if (id) {
        content = content.replace(/("database_id":\s*)"[^"]*"/, `$1"${id}"`);
        console.log(`Found database_id ${id}`);
      } else {
        console.log("Couldn't find a database_id in wrangler's output. Put it into");
        console.log("wrangler.jsonc yourself, it's printed above.");
      }
    } catch {
      console.log("`wrangler d1 create` failed. If it's an auth error, run `wrangler login`");
      console.log("first. Otherwise create the database yourself and put its database_id");
      console.log("into wrangler.jsonc.");
    }
  }

  const originalId = readFileSync("wrangler.jsonc", "utf8").match(/"database_id":\s*"([^"]*)"/)?.[1];
  const keptUpstreamId = originalId && content.includes(`"database_id": "${originalId}"`);

  // Declining this used to return early and silently drop the answers
  // collected above, which land in secrets rather than in this file and have
  // nothing to do with whether it gets rewritten.
  const wroteConfig = await writeGuarded("wrangler.jsonc", content);

  if (wroteConfig && keptUpstreamId) {
    console.log("\n! wrangler.jsonc still has the database_id it shipped with, which");
    console.log("  points at someone else's D1 database. Replace it with your own");
    console.log("  before deploying: `npx wrangler d1 create cinderbox` prints one.");
  }

  await putSecrets(secrets);

  if (await confirm("\nSet the Discord secrets now?")) {
    await putDiscordSecrets();
  }

  console.log("\nNext:");
  let step = 1;
  if (mode === "domain") {
    console.log(`  ${step++}. Check your domain's MX records point at Cloudflare Email Routing.`);
  }
  console.log(`  ${step++}. npm run cf:db:init`);
  console.log(`  ${step++}. npm run cf:deploy`);
  if (mode === "domain") {
    console.log(`  ${step++}. Add a catch-all Email Routing rule whose action is this Worker.`);
  } else {
    console.log("  No DNS or Email Routing to set up, mail.tm handles receiving.");
  }
  console.log("  Full walkthrough: docs/deploy-cloudflare.md, then docs/discord-adapter.md");
  console.log("  Want Telegram too (or instead)? docs/telegram-adapter.md, no wizard step for it yet.");
}

async function main(): Promise<void> {
  printBanner("setup");

  const major = Number(process.versions.node.split(".")[0]);
  if (major < 18) {
    console.log(`\nWarning: Node.js ${process.versions.node} is older than the supported v18.`);
  }

  console.log("\nWhere should addresses live?\n");
  console.log("  1) mail.tm's domain   nothing to buy, nothing to configure.");
  console.log("  2) a domain you own   doesn't look disposable, so it isn't");
  console.log("                        blocked by signup forms the way mail.tm is.\n");
  console.log("  Both run the same Worker on Cloudflare. You can switch later");
  console.log("  by changing DISPOSABLE_DOMAIN, no redeploy needed.\n");

  const choice = await ask("Pick one", "1");
  switch (choice) {
    case "1":
      await setupCloudflare("mailtm");
      break;
    case "2":
      await setupCloudflare("domain");
      break;
    default:
      console.log(`Not one of the options: ${choice}`);
  }
}

await main();
rl.close();
