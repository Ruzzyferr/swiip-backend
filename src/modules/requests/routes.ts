import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { BadRequestError, NotFoundError, ConflictError } from "../../lib/httpErrors.js";
import { notifyNewMatch } from "../../lib/notify.js";

const router = Router();

// Helper: Get canonical user pair (lower ID first)
function getCanonicalPair(userId1: string, userId2: string): [string, string] {
  return userId1 < userId2 ? [userId1, userId2] : [userId2, userId1];
}

const acceptSchema = z.object({
  fromUserId: z.string().cuid(),
});

const declineSchema = z.object({
  fromUserId: z.string().cuid(),
});

/**
 * GET /api/v1/requests/incoming
 * Get incoming conversation requests (pending)
 */
router.get("/incoming", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    // Parse status query param - default to PENDING, but accept all statuses
    const statusParam = req.query.status as string | undefined;
    const status = statusParam && ["PENDING", "ACCEPTED", "DECLINED"].includes(statusParam) 
      ? statusParam 
      : "PENDING";

    // Get all incoming requests (both LIKE and FAVORITE)
    const requests = await (prisma as any).conversationRequest.findMany({
      where: {
        toUserId: req.user.id,
        status: status as "PENDING" | "ACCEPTED" | "DECLINED",
        // No kind filter - show both LIKE and FAVORITE requests
      },
      include: {
        fromUser: {
          include: {
            profile: {
              select: {
                displayName: true,
                photos: true,
                city: true,
                languagesNative: true,
                languagesPractice: true,
                birthYear: true,
                bio: true,
              },
            },
          },
        },
        firstMessage: {
          select: {
            id: true,
            text: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const formattedRequests = requests.map((r: any) => ({
      requestId: r.id,
      fromUserId: r.fromUserId,
      kind: r.kind,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      fromUser: {
        userId: r.fromUser.id,
        displayName: r.fromUser.profile?.displayName || "Unknown",
        photos: r.fromUser.profile?.photos || [],
        city: r.fromUser.profile?.city || null,
        languagesNative: r.fromUser.profile?.languagesNative || [],
        languagesPractice: r.fromUser.profile?.languagesPractice || [],
        birthYear: r.fromUser.profile?.birthYear || null,
        bio: r.fromUser.profile?.bio || null,
      },
      firstMessage: r.firstMessage
        ? {
            id: r.firstMessage.id,
            text: r.firstMessage.text,
            createdAt: r.firstMessage.createdAt.toISOString(),
          }
        : null,
    }));

    res.json(formattedRequests);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/requests/outgoing
 * Get outgoing conversation requests (only FAVORITE - direct messages)
 * Normal LIKE requests are handled in the background and not shown here
 */
router.get("/outgoing", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const status = (req.query.status as string) || "PENDING";

    const requests = await (prisma as any).conversationRequest.findMany({
      where: {
        fromUserId: req.user.id,
        kind: "FAVORITE", // Only show FAVORITE (direct message) requests
        status: status as any,
      },
      include: {
        toUser: {
          include: {
            profile: {
              select: {
                displayName: true,
                photos: true,
                city: true,
                languagesNative: true,
                languagesPractice: true,
                birthYear: true,
                bio: true,
              },
            },
          },
        },
        firstMessage: {
          select: {
            id: true,
            text: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const formattedRequests = requests.map((r: any) => ({
      requestId: r.id,
      toUserId: r.toUserId,
      kind: r.kind,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      toUser: {
        userId: r.toUser.id,
        displayName: r.toUser.profile?.displayName || "Unknown",
        photos: r.toUser.profile?.photos || [],
        city: r.toUser.profile?.city || null,
        languagesNative: r.toUser.profile?.languagesNative || [],
        languagesPractice: r.toUser.profile?.languagesPractice || [],
        birthYear: r.toUser.profile?.birthYear || null,
        bio: r.toUser.profile?.bio || null,
      },
      firstMessage: r.firstMessage
        ? {
            id: r.firstMessage.id,
            text: r.firstMessage.text,
            createdAt: r.firstMessage.createdAt.toISOString(),
          }
        : null,
    }));

    res.json(formattedRequests);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/requests/accept
 * Accept an incoming conversation request
 * Creates Match + Conversation if both liked, or just Conversation if FAVORITE
 */
router.post("/accept", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const body = acceptSchema.parse(req.body);

    // Find the incoming request
    const request = await (prisma as any).conversationRequest.findUnique({
      where: {
        fromUserId_toUserId: {
          fromUserId: body.fromUserId,
          toUserId: req.user.id,
        },
      },
      include: {
        fromUser: {
          include: {
            profile: true,
          },
        },
      },
    });

    if (!request) {
      throw new NotFoundError("Request not found");
    }

    if (request.status !== "PENDING") {
      throw new BadRequestError("Request is not pending");
    }

    // Update request status to ACCEPTED
    await (prisma as any).conversationRequest.update({
      where: { id: request.id },
      data: { status: "ACCEPTED" },
    });

    let matchId: string | undefined;
    let conversationId: string | undefined;

    // If accepting a LIKE request, it means both users like each other - create Match immediately
    if (request.kind === "LIKE") {
      // Check if I already sent a LIKE request to them
      const myRequest = await (prisma as any).conversationRequest.findUnique({
        where: {
          fromUserId_toUserId: {
            fromUserId: req.user.id,
            toUserId: body.fromUserId,
          },
        },
      });

      // If I haven't sent a LIKE request yet, create one automatically
      // Accepting their LIKE = I also like them
      if (!myRequest || myRequest.kind !== "LIKE") {
        await (prisma as any).conversationRequest.upsert({
          where: {
            fromUserId_toUserId: {
              fromUserId: req.user.id,
              toUserId: body.fromUserId,
            },
          },
          create: {
            fromUserId: req.user.id,
            toUserId: body.fromUserId,
            status: "ACCEPTED",
            kind: "LIKE",
          },
          update: {
            status: "ACCEPTED",
            kind: "LIKE",
          },
        });
      } else if (myRequest.status === "PENDING") {
        // If I already sent a LIKE request but it's still PENDING, mark it as ACCEPTED
        await (prisma as any).conversationRequest.update({
          where: { id: myRequest.id },
          data: { status: "ACCEPTED" },
        });
      }

      // Create Match (both users like each other now)
      const [userAId, userBId] = getCanonicalPair(req.user.id, body.fromUserId);

      const match = await (prisma as any).match.upsert({
        where: {
          userAId_userBId: {
            userAId,
            userBId,
          },
        },
        create: {
          userAId,
          userBId,
        },
        update: {},
      });

      matchId = match.id;

      // Create conversation linked to match
      const conversation = await (prisma as any).conversation.upsert({
        where: {
          matchId: match.id,
        },
        create: {
          matchId: match.id,
        },
        update: {},
      });

      conversationId = conversation.id;

      // Notify both users
      const otherUserProfile = request.fromUser.profile;
      const currentUserProfile = await prisma.profile.findUnique({
        where: { userId: req.user.id },
        select: { displayName: true },
      });

      if (otherUserProfile && currentUserProfile) {
        await notifyNewMatch(body.fromUserId, currentUserProfile.displayName);
        await notifyNewMatch(req.user.id, otherUserProfile.displayName);
      }
    } else if (request.kind === "FAVORITE") {
      // For FAVORITE, create conversation directly (no match needed)
      const conversation = await (prisma as any).conversation.create({
        data: {
          requestId: request.id,
        },
      });

      conversationId = conversation.id;
    }

    res.json({
      success: true,
      requestId: request.id,
      matchId,
      conversationId,
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
 * POST /api/v1/requests/decline
 * Decline an incoming conversation request
 */
router.post("/decline", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const body = declineSchema.parse(req.body);

    // Find the incoming request
    const request = await (prisma as any).conversationRequest.findUnique({
      where: {
        fromUserId_toUserId: {
          fromUserId: body.fromUserId,
          toUserId: req.user.id,
        },
      },
    });

    if (!request) {
      throw new NotFoundError("Request not found");
    }

    if (request.status !== "PENDING") {
      throw new BadRequestError("Request is not pending");
    }

    // Update request status to DECLINED
    await (prisma as any).conversationRequest.update({
      where: { id: request.id },
      data: { status: "DECLINED" },
    });

    res.json({
      success: true,
      requestId: request.id,
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

