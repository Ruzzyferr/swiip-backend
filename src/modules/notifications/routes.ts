import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { BadRequestError } from "../../lib/httpErrors.js";
import { getEnv } from "../../lib/env.js";

const router = Router();

const registerTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(["IOS", "ANDROID"]),
});

/**
 * POST /api/v1/notifications/register-token
 * Register or update push token for authenticated user
 */
router.post("/register-token", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const body = registerTokenSchema.parse(req.body);

    // Upsert push token
    await prisma.pushToken.upsert({
      where: { token: body.token },
      create: {
        userId: req.user.id,
        token: body.token,
        platform: body.platform,
      },
      update: {
        userId: req.user.id,
        platform: body.platform,
        updatedAt: new Date(),
      },
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

/**
 * POST /api/v1/notifications/test
 * Admin-only endpoint to send test notification
 * Requires X-Admin-Key header
 */
router.post("/test", async (req, res, next) => {
  try {
    const adminKey = req.headers["x-admin-key"] as string;
    const env = getEnv();

    if (!env.ADMIN_KEY || adminKey !== env.ADMIN_KEY) {
      return res.status(404).json({ error: "Not found" });
    }

    const body = z
      .object({
        userId: z.string().cuid(),
      })
      .parse(req.body);

    // Get user's push tokens
    const pushTokens = await prisma.pushToken.findMany({
      where: { userId: body.userId },
    });

    // TODO: Send actual test notification
    res.json({
      message: "Test notification would be sent",
      tokensFound: pushTokens.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new BadRequestError(error.issues[0]?.message || "Validation error"));
    } else {
      next(error);
    }
  }
});

export default router;

