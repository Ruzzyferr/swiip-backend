/**
 * Simple in-memory rate limiter for reward endpoint
 * Limits: max 10 reward attempts per minute per user
 */

interface RateLimitEntry {
  count: number;
  resetAt: number; // timestamp
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10;

/**
 * Check if user has exceeded rate limit for reward endpoint
 * @param userId User ID
 * @returns true if allowed, false if rate limited
 */
export function checkRewardRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(userId);

  if (!entry || now > entry.resetAt) {
    // No entry or window expired - create new entry
    rateLimitStore.set(userId, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    // Rate limit exceeded
    return false;
  }

  // Increment count
  entry.count++;
  return true;
}

/**
 * Get remaining time until rate limit resets (in seconds)
 */
export function getRateLimitResetTime(userId: string): number | null {
  const entry = rateLimitStore.get(userId);
  if (!entry) {
    return null;
  }

  const now = Date.now();
  if (now > entry.resetAt) {
    return null;
  }

  return Math.ceil((entry.resetAt - now) / 1000);
}

/**
 * Clean up expired entries (optional, can be called periodically)
 */
export function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [userId, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(userId);
    }
  }
}

