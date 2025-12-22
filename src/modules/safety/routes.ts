import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { BadRequestError, ForbiddenError } from "../../lib/httpErrors.js";

const router = Router();

const blockSchema = z.object({
  userId: z.string().cuid(),
});

const reportSchema = z.object({
  userId: z.string().cuid(),
  reason: z.enum(["SPAM", "HARASSMENT", "NUDITY", "SCAM", "OTHER"]),
  details: z.string().max(500).optional(),
});

router.post("/block", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const body = blockSchema.parse(req.body);

    if (body.userId === req.user.id) {
      throw new BadRequestError("Cannot block yourself");
    }

    // Check if already blocked
    const existingBlock = await (prisma as any).block.findUnique({
      where: {
        blockerUserId_blockedUserId: {
          blockerUserId: req.user.id,
          blockedUserId: body.userId,
        },
      },
    });

    if (existingBlock) {
      // Already blocked, return success
      return res.status(204).send();
    }

    // Create block
    await (prisma as any).block.create({
      data: {
        blockerUserId: req.user.id,
        blockedUserId: body.userId,
      },
    });

    // Delete existing swipes between users (optional cleanup)
    await (prisma as any).swipe.deleteMany({
      where: {
        OR: [
          { fromUserId: req.user.id, toUserId: body.userId },
          { fromUserId: body.userId, toUserId: req.user.id },
        ],
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

router.post("/report", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const body = reportSchema.parse(req.body);

    if (body.userId === req.user.id) {
      throw new BadRequestError("Cannot report yourself");
    }

    // Create report
    await (prisma as any).report.create({
      data: {
        reporterUserId: req.user.id,
        reportedUserId: body.userId,
        reason: body.reason,
        details: body.details || null,
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

export default router;

