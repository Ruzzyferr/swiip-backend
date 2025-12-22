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

export default router;

