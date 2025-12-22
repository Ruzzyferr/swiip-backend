import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { getEnv } from "../../lib/env.js";
import { BadRequestError, NotFoundError } from "../../lib/httpErrors.js";

const router = Router();

// Admin middleware - check X-Admin-Key header
const adminMiddleware = (req: any, res: any, next: any) => {
  const env = getEnv();
  const adminKey = req.headers["x-admin-key"];

  if (!env.ADMIN_KEY) {
    return res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Admin endpoints are disabled",
        requestId: req.id || "unknown",
      },
    });
  }

  if (adminKey !== env.ADMIN_KEY) {
    return res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: "Invalid admin key",
        requestId: req.id || "unknown",
      },
    });
  }

  next();
};

const setPremiumSchema = z.object({
  isPremium: z.boolean(),
});

const setBanSchema = z.object({
  isBanned: z.boolean(),
});

router.post("/users/:id/premium", adminMiddleware, async (req, res, next) => {
  try {
    const userId = req.params.id;
    const body = setPremiumSchema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: userId },
      data: { isPremium: body.isPremium },
      select: {
        id: true,
        email: true,
        phone: true,
        isPremium: true,
        isBanned: true,
        createdAt: true,
      },
    });

    res.json(user);
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new BadRequestError(error.issues[0]?.message || "Validation error"));
    } else if ((error as any).code === "P2025") {
      next(new NotFoundError("User not found"));
    } else {
      next(error);
    }
  }
});

router.post("/users/:id/ban", adminMiddleware, async (req, res, next) => {
  try {
    const userId = req.params.id;
    const body = setBanSchema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: userId },
      data: { isBanned: body.isBanned },
      select: {
        id: true,
        email: true,
        phone: true,
        isPremium: true,
        isBanned: true,
        createdAt: true,
      },
    });

    res.json(user);
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new BadRequestError(error.issues[0]?.message || "Validation error"));
    } else if ((error as any).code === "P2025") {
      next(new NotFoundError("User not found"));
    } else {
      next(error);
    }
  }
});

export default router;

