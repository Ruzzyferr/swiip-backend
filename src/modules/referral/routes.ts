import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { BadRequestError } from "../../lib/httpErrors.js";

const router = Router();

/**
 * GET /api/v1/referral/me
 * Get current user's referral code
 */
router.get("/me", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { referralCode: true },
    });

    if (!user) {
      throw new BadRequestError("User not found");
    }

    res.json({
      referralCode: user.referralCode,
    });
  } catch (error) {
    next(error);
  }
});

const applyReferralSchema = z.object({
  code: z.string().min(1).max(20),
});

/**
 * POST /api/v1/referral/apply
 * Apply a referral code
 */
router.post("/apply", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const body = applyReferralSchema.parse(req.body);

    // Get current user
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { referredByUserId: true },
    });

    if (!user) {
      throw new BadRequestError("User not found");
    }

    // Check if user already has a referrer
    if (user.referredByUserId) {
      throw new BadRequestError("Referral code already applied");
    }

    // Find user with this referral code
    const referrer = await prisma.user.findUnique({
      where: { referralCode: body.code.toUpperCase() },
      select: { id: true },
    });

    if (!referrer) {
      throw new BadRequestError("Invalid referral code");
    }

    // Cannot refer yourself
    if (referrer.id === req.user.id) {
      throw new BadRequestError("Cannot use your own referral code");
    }

    // Apply referral code
    await prisma.user.update({
      where: { id: req.user.id },
      data: { referredByUserId: referrer.id },
    });

    res.status(204).send();
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new BadRequestError(error.issues[0]?.message || "Validation error"));
    } else {
      next(error);
    }
  }
});

export default router;

