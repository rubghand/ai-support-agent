import { type Db, rateLimits } from "@app/db";
import { eq, sql } from "drizzle-orm";

export interface BucketConfig {
  /** Maximum burst size. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the request would be allowed; 0 when allowed. */
  retryAfterSeconds: number;
}

/** Pure token-bucket step: refill for the elapsed time, then try to take `cost` tokens. */
export function takeTokens(
  state: { tokens: number; updatedAt: Date },
  config: BucketConfig,
  now: Date,
  cost = 1,
): { tokens: number; result: RateLimitResult } {
  const elapsedSeconds = Math.max(0, (now.getTime() - state.updatedAt.getTime()) / 1000);
  const refilled = Math.min(config.capacity, state.tokens + elapsedSeconds * config.refillPerSecond);
  if (refilled >= cost) {
    const tokens = refilled - cost;
    return { tokens, result: { allowed: true, remaining: Math.floor(tokens), retryAfterSeconds: 0 } };
  }
  return {
    tokens: refilled,
    result: {
      allowed: false,
      remaining: Math.floor(refilled),
      retryAfterSeconds: Math.ceil((cost - refilled) / config.refillPerSecond),
    },
  };
}

/**
 * Token bucket stored in Postgres, so limits hold across server instances and restarts. The row is
 * locked for the read-modify-write, so concurrent requests can't both spend the last token.
 */
export async function consume(
  db: Db,
  key: string,
  config: BucketConfig,
  { now = new Date(), cost = 1 }: { now?: Date; cost?: number } = {},
): Promise<RateLimitResult> {
  return db.transaction(async (tx) => {
    await tx
      .insert(rateLimits)
      .values({ key, tokens: config.capacity, updatedAt: now })
      .onConflictDoNothing();
    const [row] = await tx.select().from(rateLimits).where(eq(rateLimits.key, key)).for("update");
    const { tokens, result } = takeTokens(row!, config, now, cost);
    await tx.update(rateLimits).set({ tokens, updatedAt: now }).where(eq(rateLimits.key, key));
    return result;
  });
}

/** Removes buckets idle long enough to be full again; call occasionally to keep the table small. */
export async function pruneRateLimits(db: Db, olderThan: Date): Promise<void> {
  await db.delete(rateLimits).where(sql`${rateLimits.updatedAt} < ${olderThan}`);
}

/** Chat limits: generous bursts, then a steady rate. Per-IP is looser so a shared office isn't locked out. */
export const CHAT_LIMITS = {
  user: { capacity: 10, refillPerSecond: 10 / 60 },
  ip: { capacity: 30, refillPerSecond: 30 / 60 },
} as const satisfies Record<string, BucketConfig>;
