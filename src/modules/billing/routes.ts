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

/**
 * POST /api/v1/billing/purchase-boost
 * Mock endpoint to purchase boosts
 * Increases user's purchasedBoosts count
 */
router.post("/purchase-boost", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    // In a real app, verify receipt with RevenueCat/Apple/Google here
    // For now, we simulate a successful purchase of "2 Boosts" pack

    // Increment purchased boosts
    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        purchasedBoosts: {
          increment: 2
        }
      }
    });

    // Log the mock purchase
    await prisma.billingEvent.create({
      data: {
        userId: req.user.id,
        eventType: "mock_boost_purchase",
        payloadJson: JSON.stringify({ packId: "boost_2_pack", amount: 2 }),
      },
    });

    res.json({
      success: true,
      message: "Boosts purchased successfully",
      purchasedAmount: 2
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/billing/purchase-favorite
 * Mock endpoint to purchase favorites
 * Increases user's purchasedFavorites count
 */
router.post("/purchase-favorite", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    // In a real app, verify receipt with RevenueCat/Apple/Google here
    // For now, we simulate a successful purchase of "5 Favorites" pack

    // Increment purchased favorites
    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        purchasedFavorites: {
          increment: 5
        }
      }
    });

    // Log the mock purchase
    await prisma.billingEvent.create({
      data: {
        userId: req.user.id,
        eventType: "mock_favorite_purchase",
        payloadJson: JSON.stringify({ packId: "favorite_5_pack", amount: 5 }),
      },
    });

    res.json({
      success: true,
      message: "Favorites purchased successfully",
      purchasedAmount: 5
    });
  } catch (error) {
    next(error);
  }
});

export default router;
