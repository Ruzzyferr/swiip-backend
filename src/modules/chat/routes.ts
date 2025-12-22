import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { BadRequestError, NotFoundError, ForbiddenError, PaymentRequiredError } from "../../lib/httpErrors.js";
import { incrementMSG } from "../../lib/usage.js";
import { notifyNewMessage } from "../../lib/notify.js";

const router = Router();

const sendMessageSchema = z.object({
  text: z.string().min(1).max(2000),
});

router.get("/conversations", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    // Get all matches where user is either userA or userB
    // Note: If you get "Cannot read properties of undefined", run: pnpm prisma:generate
    const matches = await (prisma as any).match.findMany({
      where: {
        OR: [{ userAId: req.user.id }, { userBId: req.user.id }],
      },
      include: {
        userA: {
          include: {
            profile: true,
          },
        },
        userB: {
          include: {
            profile: true,
          },
        },
        conversation: {
          select: {
            id: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Format response (same as matches list)
    const userId = req.user.id;
    const conversations = matches.map((match: any) => {
      const otherUser =
        match.userAId === userId ? match.userB : match.userA;
      const otherProfile = otherUser.profile;

      if (!otherProfile) {
        return null;
      }

      return {
        conversationId: match.conversation?.id || null,
        matchId: match.id,
        otherUser: {
          userId: otherUser.id,
          displayName: otherProfile.displayName,
          photos: otherProfile.photos,
          city: otherProfile.city,
        },
        createdAt: match.createdAt.toISOString(),
      };
    }).filter((c: any) => c !== null);

    res.json(conversations);
  } catch (error) {
    next(error);
  }
});

router.get("/conversations/:conversationId", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const conversationId = req.params.conversationId;

    // Get conversation with match and user details
    const conversation = await (prisma as any).conversation.findUnique({
      where: { id: conversationId },
      include: {
        match: {
          include: {
            userA: {
              include: {
                profile: true,
              },
            },
            userB: {
              include: {
                profile: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundError("Conversation not found");
    }

    // Check if user is part of this match
    const userId = req.user.id;
    if (
      conversation.match.userAId !== userId &&
      conversation.match.userBId !== userId
    ) {
      throw new ForbiddenError("Access denied to this conversation");
    }

    // Check if blocked (either way)
    const otherUserId =
      conversation.match.userAId === userId
        ? conversation.match.userBId
        : conversation.match.userAId;

    const blockExists = await (prisma as any).block.findFirst({
      where: {
        OR: [
          { blockerUserId: userId, blockedUserId: otherUserId },
          { blockerUserId: otherUserId, blockedUserId: userId },
        ],
      },
    });

    if (blockExists) {
      return res.status(403).json({
        error: {
          code: "BLOCKED",
          message: "This conversation is blocked",
          requestId: req.id || "unknown",
        },
      });
    }

    // Get other user
    const otherUser =
      conversation.match.userAId === userId
        ? conversation.match.userB
        : conversation.match.userA;
    const otherProfile = otherUser.profile;

    if (!otherProfile) {
      throw new NotFoundError("Other user profile not found");
    }

    res.json({
      conversationId: conversation.id,
      matchId: conversation.match.id,
      otherUser: {
        userId: otherUser.id,
        displayName: otherProfile.displayName,
        photos: otherProfile.photos,
        city: otherProfile.city,
      },
      createdAt: conversation.createdAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/conversations/:conversationId/messages", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const conversationId = req.params.conversationId;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    // Verify user has access to this conversation
    const conversation = await (prisma as any).conversation.findUnique({
      where: { id: conversationId },
      include: {
        match: {
          select: {
            userAId: true,
            userBId: true,
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundError("Conversation not found");
    }

    // Check if user is part of this match
    const userId = req.user.id;
    const otherUserId =
      conversation.match.userAId === userId
        ? conversation.match.userBId
        : conversation.match.userAId;

    if (
      conversation.match.userAId !== userId &&
      conversation.match.userBId !== userId
    ) {
      throw new ForbiddenError("Access denied to this conversation");
    }

    // Check if blocked (either way)
    const blockExists = await (prisma as any).block.findFirst({
      where: {
        OR: [
          { blockerUserId: userId, blockedUserId: otherUserId },
          { blockerUserId: otherUserId, blockedUserId: userId },
        ],
      },
    });

    if (blockExists) {
      return res.status(403).json({
        error: {
          code: "BLOCKED",
          message: "This conversation is blocked",
          requestId: req.id || "unknown",
        },
      });
    }

    // Get messages
    const messages = await (prisma as any).message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // Reverse to get chronological order
    messages.reverse();

    res.json(
      messages.map((msg: any) => ({
        id: msg.id,
        conversationId: msg.conversationId,
        senderUserId: msg.senderUserId,
        text: msg.text,
        createdAt: msg.createdAt.toISOString(),
      }))
    );
  } catch (error) {
    next(error);
  }
});

router.post("/conversations/:conversationId/messages", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const conversationId = req.params.conversationId;
    const body = sendMessageSchema.parse(req.body);

    // Get user to check premium status
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { isPremium: true },
    });

    if (!user) {
      throw new BadRequestError("User not found");
    }

    // Verify user has access to this conversation
    const conversation = await (prisma as any).conversation.findUnique({
      where: { id: conversationId },
      include: {
        match: {
          select: {
            userAId: true,
            userBId: true,
          },
        },
        messages: {
          where: {
            senderUserId: req.user.id,
          },
          select: {
            id: true,
          },
          take: 1,
        },
      },
    });

    if (!conversation) {
      throw new NotFoundError("Conversation not found");
    }

    // Check if user is part of this match
    const userId = req.user.id;
    const otherUserId =
      conversation.match.userAId === userId
        ? conversation.match.userBId
        : conversation.match.userAId;

    if (
      conversation.match.userAId !== userId &&
      conversation.match.userBId !== userId
    ) {
      throw new ForbiddenError("Access denied to this conversation");
    }

    // Check if blocked (either way)
    const blockExists = await (prisma as any).block.findFirst({
      where: {
        OR: [
          { blockerUserId: userId, blockedUserId: otherUserId },
          { blockerUserId: otherUserId, blockedUserId: userId },
        ],
      },
    });

    if (blockExists) {
      return res.status(403).json({
        error: {
          code: "BLOCKED",
          message: "This conversation is blocked",
          requestId: req.id || "unknown",
        },
      });
    }

    // First message safety check
    const isFirstMessage = conversation.messages.length === 0;
    if (isFirstMessage && body.text.trim().length < 20) {
      return res.status(400).json({
        error: {
          code: "FIRST_MESSAGE_TOO_SHORT",
          message: "First message must be at least 20 characters. Make it more meaningful!",
          requestId: req.id || "unknown",
        },
      });
    }

    // Check and increment message usage limit
    const usage = await incrementMSG(req.user.id, user.isPremium);

    if (!usage.msgAllowed) {
      return res.status(429).json({
        error: {
          code: "MSG_LIMIT_REACHED",
          message: "Daily message limit reached. Upgrade to Premium for unlimited messages.",
          requestId: req.id || "unknown",
          details: {
            usage: {
              msgCount: usage.msgCount,
              msgLimit: usage.msgLimit,
              isPremium: usage.isPremium,
            },
          },
        },
      });
    }

    // Create message
    const message = await (prisma as any).message.create({
      data: {
        conversationId,
        senderUserId: req.user.id,
        text: body.text,
      },
    });

    // Notify the recipient of the new message
    const senderProfile = await prisma.profile.findUnique({
      where: { userId: req.user.id },
      select: { displayName: true },
    });

    if (senderProfile) {
      await notifyNewMessage(otherUserId, senderProfile.displayName);
    }

    res.status(201).json({
      id: message.id,
      conversationId: message.conversationId,
      senderUserId: message.senderUserId,
      text: message.text,
      createdAt: message.createdAt.toISOString(),
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
