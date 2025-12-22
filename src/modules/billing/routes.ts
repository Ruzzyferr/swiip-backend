import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { BadRequestError } from "../../lib/httpErrors.js";

const router = Router();

const syncBillingSchema = z.object({
  customerInfo: z.any().optional(), // Optional customer info for debugging
});

/**
 * POST /api/v1/billing/sync
 * SAFE: Does NOT update premium status (server-authoritative via webhooks)
 * Can accept customerInfo for debugging/logging purposes only
 * Returns current premium status from database
 * Requires authentication
 */
router.post("/sync", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const body = syncBillingSchema.parse(req.body);

    // Get current user from database (server source of truth)
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { isPremium: true },
    });

    if (!user) {
      throw new BadRequestError("User not found");
    }

    // Optionally log customerInfo for debugging (if provided)
    if (body.customerInfo) {
      await prisma.billingEvent.create({
        data: {
          userId: req.user.id,
          eventType: "client_sync",
          payloadJson: JSON.stringify({ customerInfo: body.customerInfo }),
        },
      });
    }

    // Return current premium status from database
    res.json({
      isPremium: user.isPremium,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new BadRequestError(error.issues[0]?.message || "Validation error"));
    } else {
      next(error);
    }
  }
});

/**
 * GET /api/v1/billing/status
 * Get current premium status and metadata
 * Requires authentication
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
        premiumSource: true,
        premiumUpdatedAt: true,
        premiumExpiresAt: true,
      },
    });

    if (!user) {
      throw new BadRequestError("User not found");
    }

    res.json({
      isPremium: user.isPremium,
      premiumSource: user.premiumSource,
      premiumUpdatedAt: user.premiumUpdatedAt?.toISOString() || null,
      premiumExpiresAt: user.premiumExpiresAt?.toISOString() || null,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

