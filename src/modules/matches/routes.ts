import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { BadRequestError, NotFoundError } from "../../lib/httpErrors.js";

const router = Router();

router.get("/", authMiddleware, async (req, res, next) => {
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

    // Format response
    const userId = req.user.id;
    const matchesList = matches.map((match: any) => {
      // Determine the other user
      const otherUser =
        match.userAId === userId ? match.userB : match.userA;
      const otherProfile = otherUser.profile;

      if (!otherProfile) {
        return null; // Skip if other user has no profile
      }

      return {
        matchId: match.id,
        conversationId: match.conversation?.id || null,
        otherUser: {
          userId: otherUser.id,
          displayName: otherProfile.displayName,
          photos: otherProfile.photos,
          city: otherProfile.city,
        },
        createdAt: match.createdAt.toISOString(),
      };
    }).filter((m: any) => m !== null);

    res.json(matchesList);
  } catch (error) {
    next(error);
  }
});

router.get("/:matchId", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const match = await (prisma as any).match.findUnique({
      where: { id: req.params.matchId },
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
    });

    if (!match) {
      throw new NotFoundError("Match not found");
    }

    // Check if user is part of this match
    if (match.userAId !== req.user.id && match.userBId !== req.user.id) {
      throw new NotFoundError("Match not found");
    }

    // Determine the other user
    const otherUser = match.userAId === req.user.id ? match.userB : match.userA;
    const otherProfile = otherUser.profile;

    if (!otherProfile) {
      throw new NotFoundError("User profile not found");
    }

    res.json({
      matchId: match.id,
      conversationId: match.conversation?.id || null,
      otherUser: {
        userId: otherUser.id,
        displayName: otherProfile.displayName,
        photos: otherProfile.photos,
        city: otherProfile.city,
      },
      createdAt: match.createdAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

export default router;

