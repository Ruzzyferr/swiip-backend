import { prisma } from "./prisma.js";
import { getEnv } from "./env.js";

/**
 * Get today's date key in YYYY-MM-DD format (UTC)
 */
export function getDayKey(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface UsageResult {
  aiCount: number;
  msgCount: number;
  aiLimit: number;
  msgLimit: number;
  isPremium: boolean;
  aiAllowed: boolean;
  msgAllowed: boolean;
}

/**
 * Increment AI usage count and check if allowed
 */
export async function incrementAI(userId: string, isPremium: boolean): Promise<UsageResult> {
  const env = getEnv();
  const dayKey = getDayKey();
  const limit = isPremium ? Infinity : env.AI_DAILY_FREE_LIMIT;

  const usage = await (prisma as any).dailyUsage.upsert({
    where: {
      userId_day: {
        userId,
        day: dayKey,
      },
    },
    create: {
      userId,
      day: dayKey,
      aiCount: 1,
      msgCount: 0,
    },
    update: {
      aiCount: {
        increment: 1,
      },
    },
  });

  const aiAllowed = isPremium || usage.aiCount <= limit;

  return {
    aiCount: usage.aiCount,
    msgCount: usage.msgCount,
    aiLimit: limit,
    msgLimit: isPremium ? Infinity : env.MSG_DAILY_FREE_LIMIT,
    isPremium,
    aiAllowed,
    msgAllowed: true, // Will be checked separately
  };
}

/**
 * Increment message count and check if allowed
 */
export async function incrementMSG(userId: string, isPremium: boolean): Promise<UsageResult> {
  const env = getEnv();
  const dayKey = getDayKey();
  const limit = isPremium ? Infinity : env.MSG_DAILY_FREE_LIMIT;

  const usage = await (prisma as any).dailyUsage.upsert({
    where: {
      userId_day: {
        userId,
        day: dayKey,
      },
    },
    create: {
      userId,
      day: dayKey,
      aiCount: 0,
      msgCount: 1,
    },
    update: {
      msgCount: {
        increment: 1,
      },
    },
  });

  const msgAllowed = isPremium || usage.msgCount <= limit;

  return {
    aiCount: usage.aiCount,
    msgCount: usage.msgCount,
    aiLimit: isPremium ? Infinity : env.AI_DAILY_FREE_LIMIT,
    msgLimit: limit,
    isPremium,
    aiAllowed: true, // Will be checked separately
    msgAllowed,
  };
}

/**
 * Get today's usage without incrementing
 */
export async function getUsage(userId: string, isPremium: boolean): Promise<UsageResult> {
  const env = getEnv();
  const dayKey = getDayKey();

  const usage = await (prisma as any).dailyUsage.findUnique({
    where: {
      userId_day: {
        userId,
        day: dayKey,
      },
    },
  });

  const aiCount = usage?.aiCount || 0;
  const msgCount = usage?.msgCount || 0;
  const aiLimit = isPremium ? Infinity : env.AI_DAILY_FREE_LIMIT;
  const msgLimit = isPremium ? Infinity : env.MSG_DAILY_FREE_LIMIT;

  return {
    aiCount,
    msgCount,
    aiLimit,
    msgLimit,
    isPremium,
    aiAllowed: isPremium || aiCount < aiLimit,
    msgAllowed: isPremium || msgCount < msgLimit,
  };
}

/**
 * Check if user needs daily like reset (UTC-based)
 */
function needsLikeReset(lastResetAt: Date | null): boolean {
  if (!lastResetAt) {
    return true;
  }

  const now = new Date();
  const lastReset = new Date(lastResetAt);

  // Check if we're on a different UTC day
  return (
    now.getUTCFullYear() !== lastReset.getUTCFullYear() ||
    now.getUTCMonth() !== lastReset.getUTCMonth() ||
    now.getUTCDate() !== lastReset.getUTCDate()
  );
}

/**
 * Reset daily likes if needed (UTC-based reset)
 */
export async function resetDailyLikesIfNeeded(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastLikeResetAt: true },
  });

  if (!user) {
    return;
  }

  // If lastLikeResetAt is null, this is the first use - reset and set it
  if (needsLikeReset(user.lastLikeResetAt)) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        dailyLikesUsed: 0,
        dailyExtraLikesFromAds: 0,
        lastLikeResetAt: new Date(),
      },
    });
  }
}

/**
 * Check if user can like (considering limits)
 */
export async function canLike(userId: string, isPremium: boolean): Promise<{
  canLike: boolean;
  likesUsed: number;
  likesRemaining: number;
  likesLimit: number;
}> {
  const env = getEnv();

  // Premium users have unlimited likes
  if (isPremium) {
    return {
      canLike: true,
      likesUsed: 0,
      likesRemaining: Infinity,
      likesLimit: Infinity,
    };
  }

  // Reset if needed
  await resetDailyLikesIfNeeded(userId);

  // Get current user state
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      dailyLikesUsed: true,
      dailyExtraLikesFromAds: true,
    },
  });

  if (!user) {
    return {
      canLike: false,
      likesUsed: 0,
      likesRemaining: 0,
      likesLimit: env.LIKE_DAILY_FREE_LIMIT,
    };
  }

  const baseLimit = env.LIKE_DAILY_FREE_LIMIT;
  const totalLimit = baseLimit + user.dailyExtraLikesFromAds;
  const likesUsed = user.dailyLikesUsed;
  const likesRemaining = Math.max(0, totalLimit - likesUsed);
  const canLikeResult = likesUsed < totalLimit;

  return {
    canLike: canLikeResult,
    likesUsed,
    likesRemaining,
    likesLimit: totalLimit,
  };
}

/**
 * Increment like count
 */
export async function incrementLike(userId: string, isPremium: boolean): Promise<{
  canLike: boolean;
  likesUsed: number;
  likesRemaining: number;
  likesLimit: number;
}> {
  // Premium users don't need tracking
  if (isPremium) {
    return {
      canLike: true,
      likesUsed: 0,
      likesRemaining: Infinity,
      likesLimit: Infinity,
    };
  }

  // Reset if needed
  await resetDailyLikesIfNeeded(userId);

  // Check before incrementing
  const checkResult = await canLike(userId, false);
  if (!checkResult.canLike) {
    return checkResult;
  }

  // Increment
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      dailyLikesUsed: {
        increment: 1,
      },
    },
    select: {
      dailyLikesUsed: true,
      dailyExtraLikesFromAds: true,
    },
  });

  const env = getEnv();
  const totalLimit = env.LIKE_DAILY_FREE_LIMIT + user.dailyExtraLikesFromAds;
  const likesRemaining = Math.max(0, totalLimit - user.dailyLikesUsed);

  return {
    canLike: true,
    likesUsed: user.dailyLikesUsed,
    likesRemaining,
    likesLimit: totalLimit,
  };
}


