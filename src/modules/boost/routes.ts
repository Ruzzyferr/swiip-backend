import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { BadRequestError, PaymentRequiredError } from "../../lib/httpErrors.js";

const router = Router();

const activateBoostSchema = z.object({
  minutes: z.enum([60, 180, 720]),
});

router.post("/activate", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const userId = req.user.id;

    // Get user to check premium status
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isPremium: true },
    });

    if (!user) {
      throw new BadRequestError("User not found");
    }

    if (!user.isPremium) {
      return res.status(403).json({
        error: {
          code: "PREMIUM_REQUIRED",
          message: "Premium subscription required to activate boost",
          requestId: req.id || "unknown",
        },
      });
    }

    const body = activateBoostSchema.parse(req.body);
    const now = new Date();
    const endsAt = new Date(now.getTime() + body.minutes * 60 * 1000);

    const boost = await (prisma as any).boost.create({
      data: {
        userId,
        startsAt: now,
        endsAt,
      },
    });

    res.json({
      startsAt: boost.startsAt.toISOString(),
      endsAt: boost.endsAt.toISOString(),
      active: true,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new BadRequestError(error.issues[0]?.message || "Validation error"));
    } else {
      next(error);
    }
  }
});

router.get("/status", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const userId = req.user.id;
    const now = new Date();

    // Get active boost
    const activeBoost = await (prisma as any).boost.findFirst({
      where: {
        userId,
        startsAt: { lte: now },
        endsAt: { gte: now },
      },
      orderBy: {
        endsAt: "desc",
      },
    });

    if (activeBoost) {
      res.json({
        active: true,
        endsAt: activeBoost.endsAt.toISOString(),
      });
    } else {
      res.json({
        active: false,
      });
    }
  } catch (error) {
    next(error);
  }
});

export default router;

