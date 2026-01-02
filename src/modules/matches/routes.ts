import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { BadRequestError, NotFoundError } from "../../lib/httpErrors.js";
import { StorageService } from "../../lib/storage.js";

const router = Router();

/**
 * GET /api/v1/matches
 * Get paginated matches for the current user
 * 
 * Query params:
 * - limit: number (default 20, max 50)
 * - cursor: string (match ID to start after)
 */
router.get("/", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    // Parse pagination params
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const cursor = req.query.cursor as string | undefined;

    const userId = req.user.id;

    // Build query with cursor-based pagination
    const matches = await (prisma as any).match.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
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
      take: limit + 1, // Fetch one extra to determine if there are more
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1, // Skip the cursor item
      }),
    });

    // Check if there are more items
    const hasMore = matches.length > limit;
    const items = hasMore ? matches.slice(0, -1) : matches;

    // Format response and transform photo URLs to presigned URLs
    const matchesList = await Promise.all(
      items
        .map(async (match: any) => {
          const otherUser =
            match.userAId === userId ? match.userB : match.userA;
          const otherProfile = otherUser.profile;

          if (!otherProfile) {
            return null;
          }

          // Transform photo URLs to presigned URLs
          const photos = await StorageService.transformPhotoUrls(otherProfile.photos, 3600);

          return {
            matchId: match.id,
            conversationId: match.conversation?.id || null,
            otherUser: {
              userId: otherUser.id,
              displayName: otherProfile.displayName,
              photos: photos,
              city: otherProfile.city,
            },
            createdAt: match.createdAt.toISOString(),
          };
        })
    );

    const filteredMatches = matchesList.filter((m: any) => m !== null);

    res.json({
      items: filteredMatches,
      nextCursor: hasMore ? items[items.length - 1]?.id : null,
      hasMore,
    });
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

    if (match.userAId !== req.user.id && match.userBId !== req.user.id) {
      throw new NotFoundError("Match not found");
    }

    const otherUser = match.userAId === req.user.id ? match.userB : match.userA;
    const otherProfile = otherUser.profile;

    if (!otherProfile) {
      throw new NotFoundError("User profile not found");
    }

    // Transform photo URLs to presigned URLs
    const photos = await StorageService.transformPhotoUrls(otherProfile.photos, 3600);

    res.json({
      matchId: match.id,
      conversationId: match.conversation?.id || null,
      otherUser: {
        userId: otherUser.id,
        displayName: otherProfile.displayName,
        photos: photos,
        city: otherProfile.city,
      },
      createdAt: match.createdAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
