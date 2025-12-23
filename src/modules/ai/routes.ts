import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { BadRequestError, ConflictError } from "../../lib/httpErrors.js";
import { incrementAI, getUsage, canLike, canSendDirect } from "../../lib/usage.js";
import { getPolishPrompt } from "./prompts.js";
import { polishMessage } from "./provider.js";

const router = Router();

const polishSchema = z.object({
  text: z.string().min(1).max(2000),
  tone: z.enum(["neutral", "friendly", "playful"]).default("neutral"),
});

// Helper: Check if profile exists
async function ensureProfileExists(userId: string): Promise<void> {
  const profile = await prisma.profile.findUnique({
    where: { userId },
  });
  if (!profile) {
    throw new ConflictError("Profile required. Please complete your profile first.");
  }
}

router.post("/polish", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    await ensureProfileExists(req.user.id);

    const body = polishSchema.parse(req.body);

    // Get user to check premium status
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { isPremium: true },
    });

    if (!user) {
      throw new BadRequestError("User not found");
    }

    // Check and increment AI usage
    const usage = await incrementAI(req.user.id, user.isPremium);

    if (!usage.aiAllowed) {
      return res.status(429).json({
        error: {
          code: "AI_LIMIT_REACHED",
          message: "Daily AI usage limit reached. Upgrade to Premium for unlimited access.",
          requestId: req.id || "unknown",
          details: {
            usage: {
              aiCount: usage.aiCount,
              aiLimit: usage.aiLimit,
              isPremium: usage.isPremium,
            },
          },
        },
      });
    }

    // Generate prompt and call AI
    const prompt = getPolishPrompt(body.text, body.tone);
    const polishedText = await polishMessage(body.text, body.tone, prompt);

    res.json({
      polishedText,
      usage: {
        aiCount: usage.aiCount,
        aiLimit: usage.aiLimit,
        isPremium: usage.isPremium,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new BadRequestError(error.issues[0]?.message || "Validation error"));
    } else {
      next(error);
    }
  }
});

router.get("/usage", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { isPremium: true },
    });

    if (!user) {
      throw new BadRequestError("User not found");
    }

    const usage = await getUsage(req.user.id, user.isPremium);
    const likeInfo = await canLike(req.user.id, user.isPremium);
    const directInfo = await canSendDirect(req.user.id, user.isPremium);

    res.json({
      usage: {
        aiCount: usage.aiCount,
        msgCount: usage.msgCount,
        aiLimit: usage.aiLimit,
        msgLimit: usage.msgLimit,
        isPremium: usage.isPremium,
        aiAllowed: usage.aiAllowed,
        msgAllowed: usage.msgAllowed,
        likesUsed: likeInfo.likesUsed,
        likesRemaining: likeInfo.likesRemaining,
        likesLimit: likeInfo.likesLimit,
        canLike: likeInfo.canLike,
        favoritesUsed: directInfo.directUsed,
        favoritesRemaining: directInfo.directRemaining,
        favoritesLimit: directInfo.directLimit,
        canFavorite: directInfo.canSend,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;


