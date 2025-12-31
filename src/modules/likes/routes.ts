import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { BadRequestError, PaymentRequiredError } from "../../lib/httpErrors.js";

const router = Router();

router.get("/incoming/count", authMiddleware, async (req, res, next) => {
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

    // Get users who liked me (excluding already matched and blocked)
    // Use ConversationRequest instead of old Swipe model
    const incomingLikes = await (prisma as any).conversationRequest.findMany({
      where: {
        toUserId: userId,
        kind: "LIKE",
        status: "PENDING", // Only show pending likes (not accepted/declined)
      },
      select: { fromUserId: true },
    });

    // Get my matches
    const myMatches = await (prisma as any).match.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      select: {
        userAId: true,
        userBId: true,
      },
    });

    const matchedUserIds = new Set(
      myMatches.flatMap((m: any) => [
        m.userAId === userId ? m.userBId : m.userAId,
      ])
    );

    // Get blocked users (both ways)
    const blocksWhereIBlocked = await (prisma as any).block.findMany({
      where: { blockerUserId: userId },
      select: { blockedUserId: true },
    });
    const blocksWhereIWasBlocked = await (prisma as any).block.findMany({
      where: { blockedUserId: userId },
      select: { blockerUserId: true },
    });
    const blockedUserIds = new Set([
      ...blocksWhereIBlocked.map((b: any) => b.blockedUserId),
      ...blocksWhereIWasBlocked.map((b: any) => b.blockerUserId),
    ]);

    // Filter out matched and blocked
    const validLikes = incomingLikes.filter(
      (like: any) =>
        !matchedUserIds.has(like.fromUserId) &&
        !blockedUserIds.has(like.fromUserId)
    );

    const count = validLikes.length;

    if (user.isPremium) {
      res.json({ count });
    } else {
      res.json({ count, blurred: true });
    }
  } catch (error) {
    next(error);
  }
});

router.get("/incoming", authMiddleware, async (req, res, next) => {
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
          message: "Premium subscription required to see who liked you",
          requestId: req.id || "unknown",
        },
      });
    }

    // Get users who liked me (excluding already matched and blocked)
    // Use ConversationRequest instead of old Swipe model
    const incomingLikes = await (prisma as any).conversationRequest.findMany({
      where: {
        toUserId: userId,
        kind: "LIKE",
        status: "PENDING", // Only show pending likes (not accepted/declined)
      },
      include: {
        fromUser: {
          include: {
            profile: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Get my matches
    const myMatches = await (prisma as any).match.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      select: {
        userAId: true,
        userBId: true,
      },
    });

    const matchedUserIds = new Set(
      myMatches.flatMap((m: any) => [
        m.userAId === userId ? m.userBId : m.userAId,
      ])
    );

    // Get blocked users (both ways)
    const blocksWhereIBlocked = await (prisma as any).block.findMany({
      where: { blockerUserId: userId },
      select: { blockedUserId: true },
    });
    const blocksWhereIWasBlocked = await (prisma as any).block.findMany({
      where: { blockedUserId: userId },
      select: { blockerUserId: true },
    });
    const blockedUserIds = new Set([
      ...blocksWhereIBlocked.map((b: any) => b.blockedUserId),
      ...blocksWhereIWasBlocked.map((b: any) => b.blockerUserId),
    ]);

    // Filter and format
    const validLikes = incomingLikes
      .filter(
        (like: any) =>
          like.fromUser.profile &&
          !matchedUserIds.has(like.fromUserId) &&
          !blockedUserIds.has(like.fromUserId)
      )
      .map((like: any) => ({
        fromUserId: like.fromUserId,
        displayName: like.fromUser.profile.displayName,
        city: like.fromUser.profile.city,
        photos: like.fromUser.profile.photos,
        createdAt: like.createdAt.toISOString(),
      }));

    res.json(validLikes);
  } catch (error) {
    next(error);
  }
});

export default router;

