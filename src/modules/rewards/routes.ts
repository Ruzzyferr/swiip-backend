import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { BadRequestError, ForbiddenError, TooManyRequestsError } from "../../lib/httpErrors.js";
import { getEnv } from "../../lib/env.js";
import { canLike, resetDailyLikesIfNeeded } from "../../lib/usage.js";
import { checkRewardRateLimit, getRateLimitResetTime } from "../../lib/rewardRateLimiter.js";

const router = Router();

/**
 * POST /api/v1/rewards/ad-like
 * Grant +3 likes for watching a rewarded ad
 * Requires authentication
 */
router.post("/ad-like", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const env = getEnv();

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        isPremium: true,
        dailyExtraLikesFromAds: true,
        lastLikeResetAt: true,
      },
    });

    if (!user) {
      throw new BadRequestError("User not found");
    }

    // Premium users don't need ads
    if (user.isPremium) {
      return res.status(403).json({
        error: {
          code: "PREMIUM_USER_NO_ADS",
          message: "Premium users have unlimited likes and don't need to watch ads",
          requestId: req.id || "unknown",
        },
      });
    }

    // Rate limit check: max 10 attempts per minute
    if (!checkRewardRateLimit(req.user.id)) {
      const resetTime = getRateLimitResetTime(req.user.id);
      return res.status(429).json({
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many reward attempts. Please try again later.",
          requestId: req.id || "unknown",
          details: {
            resetInSeconds: resetTime,
          },
        },
      });
    }

    // Reset if needed
    await resetDailyLikesIfNeeded(req.user.id);

    // Re-fetch after potential reset
    const updatedUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        dailyExtraLikesFromAds: true,
      },
    });

    if (!updatedUser) {
      throw new BadRequestError("User not found");
    }

    // Check max rewards per day
    if (updatedUser.dailyExtraLikesFromAds >= env.LIKE_MAX_REWARDS_PER_DAY * env.LIKE_REWARD_AMOUNT) {
      return res.status(429).json({
        error: {
          code: "MAX_REWARDS_REACHED",
          message: `Maximum ${env.LIKE_MAX_REWARDS_PER_DAY} rewarded ads per day. Try again tomorrow!`,
          requestId: req.id || "unknown",
          details: {
            maxRewardsPerDay: env.LIKE_MAX_REWARDS_PER_DAY,
            rewardAmount: env.LIKE_REWARD_AMOUNT,
            currentExtraLikes: updatedUser.dailyExtraLikesFromAds,
          },
        },
      });
    }

    // Grant reward
    const newExtraLikes = updatedUser.dailyExtraLikesFromAds + env.LIKE_REWARD_AMOUNT;
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        dailyExtraLikesFromAds: newExtraLikes,
      },
      select: {
        dailyLikesUsed: true,
        dailyExtraLikesFromAds: true,
      },
    });

    // Get updated like info
    const likeInfo = await canLike(req.user.id, false);

    res.json({
      success: true,
      rewardAmount: env.LIKE_REWARD_AMOUNT,
      likesInfo: {
        likesUsed: likeInfo.likesUsed,
        likesRemaining: likeInfo.likesRemaining,
        likesLimit: likeInfo.likesLimit,
        extraLikesFromAds: updated.dailyExtraLikesFromAds,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/rewards/ad-favorite
 * Grant +1 direct/favorite message for watching a rewarded ad
 * Limited to 1 per week (resets on Monday UTC)
 */
router.post("/ad-favorite", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        isPremium: true,
        weeklyFavoriteAdUsedAt: true,
        dailyDirectUsed: true,
      },
    });

    if (!user) {
      throw new BadRequestError("User not found");
    }

    // Premium users don't need ads
    if (user.isPremium) {
      return res.status(403).json({
        error: {
          code: "PREMIUM_USER_NO_ADS",
          message: "Premium users have unlimited direct messages and don't need to watch ads",
          requestId: req.id || "unknown",
        },
      });
    }

    // Rate limit check
    if (!checkRewardRateLimit(req.user.id)) {
      const resetTime = getRateLimitResetTime(req.user.id);
      return res.status(429).json({
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many reward attempts. Please try again later.",
          requestId: req.id || "unknown",
          details: {
            resetInSeconds: resetTime,
          },
        },
      });
    }

    // Check if already used this week
    const now = new Date();
    const lastUsed = user.weeklyFavoriteAdUsedAt;

    if (lastUsed) {
      // Check if we're in a new week (week starts on Monday UTC)
      const getWeekStart = (date: Date) => {
        const d = new Date(date);
        d.setUTCHours(0, 0, 0, 0);
        const day = d.getUTCDay();
        const diff = day === 0 ? -6 : 1 - day; // Adjust to get Monday
        d.setUTCDate(d.getUTCDate() + diff);
        return d;
      };

      const currentWeekStart = getWeekStart(now);
      const lastUsedWeekStart = getWeekStart(lastUsed);

      if (currentWeekStart.getTime() === lastUsedWeekStart.getTime()) {
        // Same week - already used
        const nextWeekStart = new Date(currentWeekStart);
        nextWeekStart.setUTCDate(nextWeekStart.getUTCDate() + 7);

        return res.status(429).json({
          error: {
            code: "WEEKLY_FAVORITE_AD_USED",
            message: "You've already used your weekly free favorite. Try again next week!",
            requestId: req.id || "unknown",
            details: {
              nextAvailableAt: nextWeekStart.toISOString(),
            },
          },
        });
      }
    }

    // Grant reward: Reset dailyDirectUsed to give them 1 more this week
    // Actually, we'll add a new field for external tracking, but for now
    // we decrement dailyDirectUsed by 1 (minimum 0)
    const newDirectUsed = Math.max(0, user.dailyDirectUsed - 1);

    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        weeklyFavoriteAdUsedAt: now,
        dailyDirectUsed: newDirectUsed,
      },
    });

    res.json({
      success: true,
      message: "You earned 1 free direct message this week!",
      directInfo: {
        directUsed: newDirectUsed,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/rewards/status
 * Get current reward status (weekly favorite ad availability)
 */
router.get("/status", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        isPremium: true,
        weeklyFavoriteAdUsedAt: true,
      },
    });

    if (!user) {
      throw new BadRequestError("User not found");
    }

    // Check if weekly favorite ad is available
    let weeklyFavoriteAdAvailable = true;
    let nextAvailableAt: string | null = null;

    if (user.weeklyFavoriteAdUsedAt) {
      const now = new Date();
      const getWeekStart = (date: Date) => {
        const d = new Date(date);
        d.setUTCHours(0, 0, 0, 0);
        const day = d.getUTCDay();
        const diff = day === 0 ? -6 : 1 - day;
        d.setUTCDate(d.getUTCDate() + diff);
        return d;
      };

      const currentWeekStart = getWeekStart(now);
      const lastUsedWeekStart = getWeekStart(user.weeklyFavoriteAdUsedAt);

      if (currentWeekStart.getTime() === lastUsedWeekStart.getTime()) {
        weeklyFavoriteAdAvailable = false;
        const nextWeekStart = new Date(currentWeekStart);
        nextWeekStart.setUTCDate(nextWeekStart.getUTCDate() + 7);
        nextAvailableAt = nextWeekStart.toISOString();
      }
    }

    res.json({
      weeklyFavoriteAd: {
        available: user.isPremium ? false : weeklyFavoriteAdAvailable,
        nextAvailableAt,
        isPremium: user.isPremium,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;

