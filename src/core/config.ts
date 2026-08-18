// Whoever runs a deployment owns its abuse-vs-friction tradeoff, so these are
// env vars rather than hardcoded. Defaults suit a deployment other people can
// reach; someone running it just for themselves can raise every
// RATE_LIMIT_*_MAX, or set it to 0 to drop that command's limit entirely.
export interface RateLimitConfig {
  windowSeconds: number;
  maxCount: number;
}

export interface CommandConfig {
  maxActiveAddresses: number;
  addressTtlSeconds: number;
  rateLimits: Record<string, RateLimitConfig | null>;
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function rateLimitFromEnv(
  env: Record<string, string | undefined>,
  prefix: string,
  defaultWindowSeconds: number,
  defaultMaxCount: number
): RateLimitConfig | null {
  const maxCount = parseIntEnv(env[`${prefix}_MAX`], defaultMaxCount);
  if (maxCount === 0) {
    return null; // explicitly disabled for this command
  }
  return {
    windowSeconds: parseIntEnv(env[`${prefix}_WINDOW_SECONDS`], defaultWindowSeconds),
    maxCount,
  };
}

export function buildCommandConfig(env: Record<string, string | undefined>): CommandConfig {
  return {
    maxActiveAddresses: parseIntEnv(env.MAX_ACTIVE_ADDRESSES, 5),
    addressTtlSeconds: parseIntEnv(env.ADDRESS_TTL_SECONDS, 10 * 24 * 60 * 60),
    rateLimits: {
      new: rateLimitFromEnv(env, "RATE_LIMIT_NEW", 30, 1),
      list: rateLimitFromEnv(env, "RATE_LIMIT_LIST", 60, 15),
      extend: rateLimitFromEnv(env, "RATE_LIMIT_EXTEND", 60, 15),
      torch: rateLimitFromEnv(env, "RATE_LIMIT_TORCH", 60, 15),
      note: rateLimitFromEnv(env, "RATE_LIMIT_NOTE", 60, 15),
      remind: rateLimitFromEnv(env, "RATE_LIMIT_REMIND", 60, 15),
    },
  };
}
