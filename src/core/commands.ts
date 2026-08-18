import type { SqlExecutor } from "./storage.ts";
import type { OwnerRef } from "./types.ts";

// How a new address actually gets created differs by mode: a domain you own
// means inventing a random local part, mail.tm means calling their API and
// getting an address back. Injecting this keeps command handling identical
// across both instead of each needing its own copy of /new, /list, /extend,
// /torch, and identical again across every chat platform adapter.
export type CreateAddressFn = (
  db: SqlExecutor,
  owner: OwnerRef,
  ttlSeconds: number,
  permanent: boolean,
  note: string | null
) => Promise<string>;

// Also applied by Discord itself via max_length/max_value on the registered
// commands, so out-of-range input is normally rejected in its UI before
// reaching the Worker. Enforced here too for anything that arrives another
// way, and for adapters (like Telegram) with no equivalent client-side
// enforcement at all.
//
// A note is long enough to be a useful label, short enough that /list stays
// scannable. Past MAX_EXPIRY_DAYS an expiry stops being a meaningful date,
// and anyone wanting longer wants a permanent address anyway.
export const MAX_NOTE_LENGTH = 80;
export const MAX_EXPIRY_DAYS = 3650;

export interface Expiry {
  ttlSeconds: number;
  permanent: boolean;
}

// `expiry` is in days, 0 meaning permanent.
//
// Permanent still carries the default TTL rather than 0: core/db.ts keeps
// expires_at fresh even on permanent rows deliberately, so that dropping the
// flag later leaves a usable expiry instead of one that lapsed while the
// address was permanent.
export function parseExpiry(days: number, defaultTtlSeconds: number): Expiry | null {
  if (days < 0 || days > MAX_EXPIRY_DAYS) {
    return null;
  }
  return days === 0
    ? { ttlSeconds: defaultTtlSeconds, permanent: true }
    : { ttlSeconds: days * 86400, permanent: false };
}

export function describeExpiry(expiry: Expiry): string {
  if (expiry.permanent) {
    return "Permanent, good until you torch it.";
  }
  const days = Math.round(expiry.ttlSeconds / 86400);
  return `Expires in ${days} day${days === 1 ? "" : "s"}.`;
}

export const BAD_EXPIRY_MESSAGE = `\`expiry\` must be a whole number of days between 0 and ${MAX_EXPIRY_DAYS}. Use 0 for permanent.`;
