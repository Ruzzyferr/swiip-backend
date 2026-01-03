import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { BadRequestError } from "../../lib/httpErrors.js";

const router = Router();

// 30 minutes in milliseconds
const BOOST_DURATION_MS = 30 * 60 * 1000;
const WEEKLY_BOOST_LIMIT = 2;

/**
 * Get week key in YYYY-WWW format (ISO week)
 */
function getWeekKey(date: Date): string {
  const year = date.getUTCFullYear();
  const day = date.getUTCDay();
  const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.getTime());
  monday.setUTCDate(diff);
  const start = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((monday.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  const week = Math.ceil((days + 1) / 7);
  return `${year}-W${week}`;
}

router.post("/activate", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const userId = req.user.id;
    const now = new Date();

    // Get user to check premium status, boost usage, and purchased boosts
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        isPremium: true,
        weeklyBoostsUsed: true,
        lastBoostResetAt: true,
        currentBoostEndsAt: true,
        purchasedBoosts: true,
      },
    });

    if (!user) {
      throw new BadRequestError("User not found");
    }

    // 1. Check if boost is already active
    if (user.currentBoostEndsAt && user.currentBoostEndsAt > now) {
      return res.status(400).json({
        error: {
          code: "BOOST_ALREADY_ACTIVE",
          message: "Zaten aktif bir boostunuz var.",
          requestId: req.id || "unknown",
        },
      });
    }

    // 2. Reset weekly boost counter if a new week has started
    let currentWeeklyBoostsUsed = user.weeklyBoostsUsed;
    let currentLastBoostResetAt = user.lastBoostResetAt;

    if (!currentLastBoostResetAt) {
      // First time boosting or reset not recorded, initialize
      currentWeeklyBoostsUsed = 0;
      currentLastBoostResetAt = now;
    } else {
      const currentWeekParam = getWeekKey(now);
      const lastResetWeekParam = getWeekKey(currentLastBoostResetAt);
      if (currentWeekParam !== lastResetWeekParam) {
        // New week, reset counter
        currentWeeklyBoostsUsed = 0;
        currentLastBoostResetAt = now;
      }
    }

    // 3. Check boost availability and determine source (WEEKLY or PURCHASED)
    let boostSource: "WEEKLY" | "PURCHASED" | null = null;
    let newPurchasedBoosts = user.purchasedBoosts;
    let newWeeklyBoostsUsed = currentWeeklyBoostsUsed;

    // Priority 1: Weekly Free Boosts (Premium Only)
    // Note: Premium users get free weekly boosts.
    if (user.isPremium && newWeeklyBoostsUsed < WEEKLY_BOOST_LIMIT) {
      boostSource = "WEEKLY";
      newWeeklyBoostsUsed++;
    }
    // Priority 2: Purchased Boosts
    // Anyone can use purchased boosts
    else if (user.purchasedBoosts > 0) {
      boostSource = "PURCHASED";
      newPurchasedBoosts--;
    }

    if (!boostSource) {
      return res.status(403).json({
        error: {
          code: "NO_BOOSTS_REMAINING",
          message: "Boost hakkınız kalmadı. Premium üye olarak haftalık hak kazanabilir veya boost paketi satın alabilirsiniz.",
          details: {
            weeklyLimit: WEEKLY_BOOST_LIMIT,
            boostsRemaining: 0
          }
        },
      });
    }

    // 4. Activate Boost
    const endsAt = new Date(now.getTime() + BOOST_DURATION_MS);

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        currentBoostEndsAt: endsAt,
        weeklyBoostsUsed: newWeeklyBoostsUsed,
        purchasedBoosts: newPurchasedBoosts,
        lastBoostResetAt: currentLastBoostResetAt,
      },
      select: {
        purchasedBoosts: true,
        weeklyBoostsUsed: true,
        isPremium: true,
      }
    });

    // Create history record
    await prisma.boost.create({
      data: {
        userId,
        startsAt: now,
        endsAt,
        durationMinutes: 30, // 30 minutes
      },
    });

    // Calculate remaining
    let remaining = updatedUser.purchasedBoosts;
    if (updatedUser.isPremium) {
      remaining += Math.max(0, WEEKLY_BOOST_LIMIT - updatedUser.weeklyBoostsUsed);
    }

    return res.json({
      active: true,
      startsAt: now.toISOString(),
      endsAt: endsAt.toISOString(),
      boostsRemaining: remaining,
      weeklyLimit: WEEKLY_BOOST_LIMIT,
      source: boostSource
    });
  } catch (error) {
    next(error);
  }
});

router.get("/status", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const userId = req.user.id;
    const now = new Date();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        isPremium: true,
        currentBoostEndsAt: true,
        weeklyBoostsUsed: true,
        lastBoostResetAt: true,
        purchasedBoosts: true
      },
    });

    if (!user) {
      throw new BadRequestError("User not found");
    }

    // Check reset for display purposes
    let weeklyBoostsUsed = user.weeklyBoostsUsed;
    if (user.lastBoostResetAt) {
      const currentWeekParam = getWeekKey(now);
      const lastResetWeekParam = getWeekKey(user.lastBoostResetAt);
      if (currentWeekParam !== lastResetWeekParam) {
        weeklyBoostsUsed = 0;
      }
    }

    const active = user.currentBoostEndsAt ? user.currentBoostEndsAt > now : false;

    let boostsRemaining = user.purchasedBoosts;
    if (user.isPremium) {
      boostsRemaining += Math.max(0, WEEKLY_BOOST_LIMIT - weeklyBoostsUsed);
    }

    res.json({
      active,
      endsAt: active ? user.currentBoostEndsAt?.toISOString() : null,
      boostsRemaining,
      weeklyLimit: WEEKLY_BOOST_LIMIT
    });
  } catch (error) {
    next(error);
  }
});

export default router;
