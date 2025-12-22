import { Router, Request, Response, NextFunction } from "express";
import express from "express";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError, BadRequestError } from "../../lib/httpErrors.js";
import {
  verifyRevenueCatSignature,
  extractAppUserId,
  isPremiumActive,
  extractPremiumExpiresAt,
  extractEventType,
} from "../../lib/revenuecat.js";
import { logger } from "../../lib/logger.js";

const router = Router();

/**
 * POST /api/v1/webhooks/revenuecat
 * RevenueCat webhook endpoint (no auth required, uses signature verification)
 * 
 * Note: RevenueCat sends signature in Authorization header.
 * We use express.raw() to capture the raw body for signature verification.
 * This middleware must be applied before express.json() in the main app.
 */
router.post(
  "/revenuecat",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get signature from header
      // RevenueCat sends it in Authorization header
      const authHeader = req.headers["authorization"] as string;
      
      if (!authHeader) {
        logger.warn("RevenueCat webhook received without authorization header");
        return res.status(401).json({ error: "Missing authorization header" });
      }

      // Extract signature (format: "Bearer t=<timestamp>,v1=<signature>" or just the signature part)
      const signature = authHeader.startsWith("Bearer ") 
        ? authHeader.substring(7) 
        : authHeader;

      // Get raw body for signature verification
      const rawBody = req.body instanceof Buffer 
        ? req.body.toString("utf8")
        : "";

      if (!rawBody) {
        logger.error("RevenueCat webhook received empty body");
        return res.status(400).json({ error: "Empty body" });
      }

      // Verify authorization (RevenueCat sends secret in Authorization header)
      if (!verifyRevenueCatSignature(rawBody, authHeader)) {
        logger.error("RevenueCat webhook authorization verification failed");
        return res.status(401).json({ error: "Invalid authorization" });
      }

      // Parse body
      const payload = JSON.parse(rawBody);


    // Extract app_user_id (should match our User.id)
    const appUserId = extractAppUserId(payload);
    if (!appUserId) {
      logger.warn("RevenueCat webhook missing app_user_id");
      return res.status(400).json({ error: "Missing app_user_id" });
    }

    // Find user by ID
    const user = await prisma.user.findUnique({
      where: { id: appUserId },
    });

    if (!user) {
      logger.warn(`RevenueCat webhook for unknown user: ${appUserId}`);
      // Don't return error - user might not exist yet, but we should still log the event
      // Return 200 to acknowledge receipt
      return res.status(200).json({ received: true, userNotFound: true });
    }

    // Extract premium status
    const premiumActive = isPremiumActive(payload);
    const premiumExpiresAt = extractPremiumExpiresAt(payload);
    const eventType = extractEventType(payload);

    // Update user premium status
    await prisma.user.update({
      where: { id: appUserId },
      data: {
        isPremium: premiumActive,
        premiumSource: "revenuecat",
        premiumUpdatedAt: new Date(),
        premiumExpiresAt: premiumExpiresAt,
      },
    });

    // Log billing event
    await prisma.billingEvent.create({
      data: {
        userId: appUserId,
        eventType: eventType,
        payloadJson: JSON.stringify(payload),
      },
    });

    logger.info(
      `RevenueCat webhook processed: user=${appUserId}, premium=${premiumActive}, event=${eventType}`
    );

    res.status(200).json({ received: true });
  } catch (error) {
    logger.error("Error processing RevenueCat webhook:", error);
    next(error);
  }
});

export default router;

