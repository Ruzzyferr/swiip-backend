import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { BadRequestError, NotFoundError, ForbiddenError, PaymentRequiredError } from "../../lib/httpErrors.js";
import { incrementMSG } from "../../lib/usage.js";
import { notifyNewMessage } from "../../lib/notify.js";
import { emitNewMessage } from "../../lib/socket.js";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs/promises";
import { StorageService } from "../../lib/storage.js";

const router = Router();

const sendMessageSchema = z.object({
  // Increased to 8000 to account for emoji surrogate pairs (each emoji can be 2-8+ code units)
  text: z.string().min(1).max(8000),
});

// Get total unread message count across all conversations
router.get("/unread-count", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const userId = req.user.id;

    // Get all conversation IDs where user is a participant
    const matches = await (prisma as any).match.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      select: {
        conversation: {
          select: { id: true },
        },
      },
    });

    const favoriteConversations = await (prisma as any).conversation.findMany({
      where: {
        requestId: { not: null },
        request: {
          OR: [{ fromUserId: userId }, { toUserId: userId }],
          status: "ACCEPTED",
        },
      },
      select: { id: true },
    });

    const conversationIds = [
      ...matches.filter((m: any) => m.conversation).map((m: any) => m.conversation.id),
      ...favoriteConversations.map((c: any) => c.id),
    ];

    // Count unread messages (not sent by current user)
    const unreadCount = await (prisma as any).message.count({
      where: {
        conversationId: { in: conversationIds },
        senderUserId: { not: userId },
        isRead: false,
      },
    });

    res.json({ unreadCount });
  } catch (error) {
    next(error);
  }
});

router.get("/conversations", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const userId = req.user.id;

    // Get all matches where user is either userA or userB
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
            createdAt: true,
            messages: {
              orderBy: {
                createdAt: "desc",
              },
              take: 1,
              select: {
                id: true,
                text: true,
                audioUrl: true,
                createdAt: true,
                senderUserId: true,
                isRead: true,
              }
            }
          },
        },
      },
    });

    // Get all conversations from FAVORITE requests where user is either sender or receiver
    const favoriteConversations = await (prisma as any).conversation.findMany({
      where: {
        requestId: {
          not: null,
        },
        request: {
          OR: [
            { fromUserId: userId },
            { toUserId: userId },
          ],
          status: "ACCEPTED",
        },
      },
      include: {
        request: {
          include: {
            fromUser: {
              include: {
                profile: true,
              },
            },
            toUser: {
              include: {
                profile: true,
              },
            },
            firstMessage: true,
          },
        },
        messages: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
          select: {
            id: true,
            text: true,
            audioUrl: true,
            createdAt: true,
            senderUserId: true,
            isRead: true,
          }
        }
      },
    });

    // Format match-based conversations
    const matchConversations = await Promise.all(
      matches
        .filter((match: any) => match.conversation) // Only include matches with conversations
        .map(async (match: any) => {
          const otherUser =
            match.userAId === userId ? match.userB : match.userA;
          const otherProfile = otherUser.profile;

          if (!otherProfile) {
            return null;
          }

          const lastMessage = match.conversation.messages[0] || null;

          // Count unread messages in this conversation (messages from other user that are not read)
          const unreadCount = await (prisma as any).message.count({
            where: {
              conversationId: match.conversation.id,
              senderUserId: { not: userId },
              isRead: false,
            },
          });

          // Transform photo URLs to presigned URLs
          const photos = await StorageService.transformPhotoUrls(otherProfile.photos, 3600);

          return {
            conversationId: match.conversation.id,
            matchId: match.id,
            otherUser: {
              userId: otherUser.id,
              displayName: otherProfile.displayName,
              photos: photos,
              city: otherProfile.city,
            },
            createdAt: match.conversation.createdAt.toISOString(),
            lastMessage: lastMessage ? {
              text: lastMessage.text,
              audioUrl: lastMessage.audioUrl
                ? await StorageService.transformAudioUrl(lastMessage.audioUrl, 3600)
                : null,
              createdAt: lastMessage.createdAt.toISOString(),
              senderUserId: lastMessage.senderUserId,
            } : null,
            unreadCount,
          };
        })
    );
    const filteredMatchConversations = matchConversations.filter((c: any) => c !== null);

    // Format request-based conversations (FAVORITE)
    const requestConversations = await Promise.all(
      favoriteConversations.map(async (conv: any) => {
        const request = conv.request;
        const otherUser = request.fromUserId === userId ? request.toUser : request.fromUser;
        const otherProfile = otherUser?.profile;

        if (!otherProfile) {
          return null;
        }

        let lastMessage = conv.messages[0] || null;

        // If no messages yet, use firstMessage from request
        if (!lastMessage && request.firstMessage) {
          lastMessage = {
            text: request.firstMessage.text,
            createdAt: request.firstMessage.createdAt,
            senderUserId: request.fromUserId,
          };
        }

        // Count unread messages in this conversation
        const unreadCount = await (prisma as any).message.count({
          where: {
            conversationId: conv.id,
            senderUserId: { not: userId },
            isRead: false,
          },
        });

        // Transform photo URLs to presigned URLs
        const photos = await StorageService.transformPhotoUrls(otherProfile.photos, 3600);

        return {
          conversationId: conv.id,
          matchId: null,
          otherUser: {
            userId: otherUser.id,
            displayName: otherProfile.displayName,
            photos: photos,
            city: otherProfile.city,
          },
          createdAt: conv.createdAt.toISOString(),
          lastMessage: lastMessage ? {
            text: lastMessage.text,
            audioUrl: lastMessage.audioUrl
              ? await StorageService.transformAudioUrl(lastMessage.audioUrl, 3600)
              : null,
            createdAt: new Date(lastMessage.createdAt).toISOString(),
            senderUserId: lastMessage.senderUserId,
          } : null,
          unreadCount,
        };
      })
    );
    const filteredRequestConversations = requestConversations.filter((c: any) => c !== null);

    // Combine and sort by lastMessageAt or createdAt
    const allConversations = [...filteredMatchConversations, ...filteredRequestConversations].sort(
      (a: any, b: any) => {
        const timeA = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : new Date(a.createdAt).getTime();
        const timeB = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : new Date(b.createdAt).getTime();
        return timeB - timeA;
      }
    );

    res.json(allConversations);
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
    const userId = req.user.id;

    // Get conversation with match and request details
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
        request: {
          include: {
            fromUser: {
              include: {
                profile: true,
              },
            },
            toUser: {
              include: {
                profile: true,
              },
            },
            firstMessage: true,
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundError("Conversation not found");
    }

    let otherUser: any;
    let otherProfile: any;
    let matchId: string | null = null;

    // Handle conversation from MATCH (LIKE requests)
    if (conversation.match) {
      // Check if user is part of this match
      if (
        conversation.match.userAId !== userId &&
        conversation.match.userBId !== userId
      ) {
        throw new ForbiddenError("Access denied to this conversation");
      }

      // Get other user from match
      otherUser =
        conversation.match.userAId === userId
          ? conversation.match.userB
          : conversation.match.userA;
      otherProfile = otherUser.profile;
      matchId = conversation.match.id;
    }
    // Handle conversation from REQUEST (FAVORITE requests)
    else if (conversation.request) {
      const request = conversation.request;

      // Check if user is part of this request (either sender or receiver)
      if (request.fromUserId !== userId && request.toUserId !== userId) {
        throw new ForbiddenError("Access denied to this conversation");
      }

      // Get other user from request
      otherUser = request.fromUserId === userId ? request.toUser : request.fromUser;
      otherProfile = otherUser?.profile;
    } else {
      throw new NotFoundError("Conversation has no associated match or request");
    }

    if (!otherProfile) {
      throw new NotFoundError("Other user profile not found");
    }

    // Check if blocked (either way)
    const otherUserId = otherUser.id;
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

    // Get firstMessage if this is a FAVORITE request conversation
    let firstMessage = null;
    if (conversation.request && conversation.request.firstMessage) {
      firstMessage = {
        id: conversation.request.firstMessage.id,
        text: conversation.request.firstMessage.text,
        createdAt: conversation.request.firstMessage.createdAt.toISOString(),
      };
    }

    // Get current user's profile for gender check
    const currentUserProfile = await prisma.profile.findUnique({
      where: { userId },
      select: { gender: true },
    });

    // Check if there are any messages in this conversation
    const messageCount = await (prisma as any).message.count({
      where: { conversationId: conversation.id },
    });

    // Transform photo URLs to presigned URLs
    const photos = await StorageService.transformPhotoUrls(otherProfile.photos, 3600);

    res.json({
      conversationId: conversation.id,
      matchId,
      otherUser: {
        userId: otherUser.id,
        displayName: otherProfile.displayName,
        photos: photos,
        city: otherProfile.city,
        gender: otherProfile.gender,
      },
      currentUserGender: currentUserProfile?.gender || null,
      firstMessage,
      hasMessages: messageCount > 0,
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
    const userId = req.user.id;

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
        request: {
          select: {
            fromUserId: true,
            toUserId: true,
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundError("Conversation not found");
    }

    // Check if user is part of this conversation (either via match or request)
    let otherUserId: string;

    if (conversation.match) {
      // Conversation from MATCH (LIKE requests)
      if (
        conversation.match.userAId !== userId &&
        conversation.match.userBId !== userId
      ) {
        throw new ForbiddenError("Access denied to this conversation");
      }
      otherUserId =
        conversation.match.userAId === userId
          ? conversation.match.userBId
          : conversation.match.userAId;
    } else if (conversation.request) {
      // Conversation from REQUEST (FAVORITE requests)
      const request = conversation.request;
      if (request.fromUserId !== userId && request.toUserId !== userId) {
        throw new ForbiddenError("Access denied to this conversation");
      }
      otherUserId = request.fromUserId === userId ? request.toUserId : request.fromUserId;
    } else {
      throw new NotFoundError("Conversation has no associated match or request");
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

    // Transform audio URLs to presigned URLs
    const messagesWithPresignedUrls = await Promise.all(
      messages.map(async (msg: any) => ({
        id: msg.id,
        conversationId: msg.conversationId,
        senderUserId: msg.senderUserId,
        text: msg.text,
        audioUrl: msg.audioUrl
          ? await StorageService.transformAudioUrl(msg.audioUrl, 3600)
          : null,
        isRead: msg.isRead,
        createdAt: msg.createdAt.toISOString(),
      }))
    );

    res.json(messagesWithPresignedUrls);
  } catch (error) {
    next(error);
  }
});

// Mark messages as read in a conversation
router.post("/conversations/:conversationId/read", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const conversationId = req.params.conversationId;
    const userId = req.user.id;

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
        request: {
          select: {
            fromUserId: true,
            toUserId: true,
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundError("Conversation not found");
    }

    // Check if user is part of this conversation
    let hasAccess = false;
    if (conversation.match) {
      hasAccess = conversation.match.userAId === userId || conversation.match.userBId === userId;
    } else if (conversation.request) {
      hasAccess = conversation.request.fromUserId === userId || conversation.request.toUserId === userId;
    }

    if (!hasAccess) {
      throw new ForbiddenError("Access denied to this conversation");
    }

    // Mark all messages from other users as read
    const result = await (prisma as any).message.updateMany({
      where: {
        conversationId,
        senderUserId: { not: userId },
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });

    res.json({
      success: true,
      markedAsRead: result.count
    });
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
        request: {
          select: {
            fromUserId: true,
            toUserId: true,
          },
        },
        messages: {
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

    // Check if user is part of this conversation (either via match or request)
    const userId = req.user.id;
    let otherUserId: string;

    if (conversation.match) {
      // Conversation from MATCH (LIKE requests)
      if (
        conversation.match.userAId !== userId &&
        conversation.match.userBId !== userId
      ) {
        throw new ForbiddenError("Access denied to this conversation");
      }
      otherUserId =
        conversation.match.userAId === userId
          ? conversation.match.userBId
          : conversation.match.userAId;
    } else if (conversation.request) {
      // Conversation from REQUEST (FAVORITE requests)
      const request = conversation.request;
      if (request.fromUserId !== userId && request.toUserId !== userId) {
        throw new ForbiddenError("Access denied to this conversation");
      }
      otherUserId = request.fromUserId === userId ? request.toUserId : request.fromUserId;
    } else {
      throw new NotFoundError("Conversation has no associated match or request");
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

    // First message gender restriction: In male-female matches, only females can send first message
    if (isFirstMessage) {
      // Get both users' profiles with gender
      const senderProfile = await prisma.profile.findUnique({
        where: { userId: req.user.id },
        select: { gender: true },
      });

      const otherUserProfile = await prisma.profile.findUnique({
        where: { userId: otherUserId },
        select: { gender: true },
      });

      // Only apply restriction if both users have gender set and it's a male-female match
      if (senderProfile?.gender && otherUserProfile?.gender) {
        const isMaleFemaleMatch =
          (senderProfile.gender === "MALE" && otherUserProfile.gender === "FEMALE") ||
          (senderProfile.gender === "FEMALE" && otherUserProfile.gender === "MALE");

        if (isMaleFemaleMatch && senderProfile.gender === "MALE") {
          return res.status(403).json({
            error: {
              code: "FIRST_MESSAGE_RESTRICTED",
              message: "In male-female matches, the first message must be sent by the female. Please wait for them to message first.",
              requestId: req.id || "unknown",
            },
          });
        }
      }
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
      await notifyNewMessage(otherUserId, senderProfile.displayName, body.text);
    }

    // Emit via WebSocket for real-time delivery
    emitNewMessage(conversationId, {
      id: message.id,
      conversationId: message.conversationId,
      senderUserId: message.senderUserId,
      text: message.text,
      audioUrl: null,
      createdAt: message.createdAt.toISOString(),
    });

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

// Configure multer for audio uploads (Memory Storage for S3)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new BadRequestError("Only audio files are allowed"));
    }
  },
});

/**
 * POST /api/v1/chat/conversations/:conversationId/messages/audio
 * Send an audio message
 */
router.post(
  "/conversations/:conversationId/messages/audio",
  authMiddleware,
  upload.single("audio"),
  async (req, res, next) => {
    try {
      if (!req.user) {
        throw new BadRequestError("User not found");
      }

      if (!req.file) {
        throw new BadRequestError("Audio file is required");
      }

      const conversationId = req.params.conversationId;
      const userId = req.user.id;

      // Get user to check premium status
      const user = await prisma.user.findUnique({
        where: { id: userId },
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
          request: {
            select: {
              fromUserId: true,
              toUserId: true,
            },
          },
        },
      });

      if (!conversation) {
        throw new NotFoundError("Conversation not found");
      }

      // Check if user is part of this conversation
      let otherUserId: string;

      if (conversation.match) {
        if (
          conversation.match.userAId !== userId &&
          conversation.match.userBId !== userId
        ) {
          throw new ForbiddenError("Access denied to this conversation");
        }
        otherUserId =
          conversation.match.userAId === userId
            ? conversation.match.userBId
            : conversation.match.userAId;
      } else if (conversation.request) {
        const request = conversation.request;
        if (request.fromUserId !== userId && request.toUserId !== userId) {
          throw new ForbiddenError("Access denied to this conversation");
        }
        otherUserId = request.fromUserId === userId ? request.toUserId : request.fromUserId;
      } else {
        throw new NotFoundError("Conversation has no associated match or request");
      }

      // Check if blocked
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

      // Check and increment message usage limit
      const usage = await incrementMSG(userId, user.isPremium);
      if (!usage.msgAllowed) {
        return res.status(429).json({
          error: {
            code: "MSG_LIMIT_REACHED",
            message: "Daily message limit reached. Upgrade to Premium for unlimited messages.",
            requestId: req.id || "unknown",
            details: {
              msgCount: usage.msgCount,
              msgLimit: usage.msgLimit,
              isPremium: user.isPremium,
            },
          },
        });
      }

      // Upload audio to S3/MinIO with metadata
      const audioUrl = await StorageService.uploadFile(req.file, "audio", {
        metadata: {
          'uploaded-by': userId,
          'conversation-id': conversationId,
        }
      });

      // Create message with audio
      const message = await (prisma as any).message.create({
        data: {
          conversationId,
          senderUserId: userId,
          text: "", // Empty text for audio messages
          audioUrl,
        },
      });

      // Transform audio URL to presigned URL for response
      const presignedAudioUrl = await StorageService.transformAudioUrl(audioUrl, 3600);

      // Notify other user
      const senderProfile = await prisma.profile.findUnique({
        where: { userId },
        select: { displayName: true },
      });

      if (senderProfile) {
        await notifyNewMessage(otherUserId, senderProfile.displayName, "🎤 Sesli mesaj");
      }

      // Emit via WebSocket for real-time delivery
      emitNewMessage(conversationId, {
        id: message.id,
        conversationId: message.conversationId,
        senderUserId: message.senderUserId,
        text: message.text,
        audioUrl: presignedAudioUrl,
        createdAt: message.createdAt.toISOString(),
      });

      res.json({
        id: message.id,
        conversationId: message.conversationId,
        senderUserId: message.senderUserId,
        text: message.text,
        audioUrl: presignedAudioUrl, // Return presigned URL
        createdAt: message.createdAt.toISOString(),
      });
    } catch (error) {
      // Clean up uploaded file on error
      if (req.file) {
        try {
          await fs.unlink(req.file.path);
        } catch (unlinkError) {
          console.error("Failed to delete uploaded file:", unlinkError);
        }
      }
      if (error instanceof z.ZodError) {
        next(new BadRequestError(error.issues[0]?.message || "Validation error"));
      } else {
        next(error);
      }
    }
  }
);

/**
 * GET /api/v1/chat/requests
 * Get pending FAVORITE requests (direct messages) with first message visible
 */
router.get("/requests", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    // Get incoming FAVORITE requests that are PENDING
    const requests = await (prisma as any).conversationRequest.findMany({
      where: {
        toUserId: req.user.id,
        status: "PENDING",
        kind: "FAVORITE",
      },
      include: {
        fromUser: {
          include: {
            profile: {
              select: {
                displayName: true,
                photos: true,
                city: true,
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
      createdAt: r.createdAt.toISOString(),
      fromUser: {
        userId: r.fromUser.id,
        displayName: r.fromUser.profile?.displayName || "Unknown",
        photos: r.fromUser.profile?.photos || [],
        city: r.fromUser.profile?.city || null,
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
 * POST /api/v1/chat/requests/:requestId/reply
 * Reply to a FAVORITE request - activates conversation
 */
router.post("/requests/:requestId/reply", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const body = sendMessageSchema.parse(req.body);
    const requestId = req.params.requestId;

    // Find the request
    const request = await (prisma as any).conversationRequest.findUnique({
      where: { id: requestId },
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

    if (request.toUserId !== req.user.id) {
      throw new ForbiddenError("You can only reply to requests sent to you");
    }

    if (request.status !== "PENDING") {
      throw new BadRequestError("Request is not pending");
    }

    if (request.kind !== "FAVORITE") {
      throw new BadRequestError("Can only reply to FAVORITE requests");
    }

    // Check if conversation already exists
    let conversation = await (prisma as any).conversation.findUnique({
      where: { requestId: request.id },
      include: {
        messages: {
          select: { id: true },
          take: 1,
        },
      },
    });

    // Check if this is the first message in the conversation
    const isFirstMessage = !conversation || conversation.messages.length === 0;

    // First message gender restriction: In male-female matches, only females can send first message
    if (isFirstMessage) {
      // Get both users' profiles with gender
      const currentUserProfile = await prisma.profile.findUnique({
        where: { userId: req.user.id },
        select: { gender: true },
      });

      const fromUserProfile = request.fromUser?.profile;

      // Only apply restriction if both users have gender set and it's a male-female match
      if (currentUserProfile?.gender && fromUserProfile?.gender) {
        const isMaleFemaleMatch =
          (currentUserProfile.gender === "MALE" && fromUserProfile.gender === "FEMALE") ||
          (currentUserProfile.gender === "FEMALE" && fromUserProfile.gender === "MALE");

        if (isMaleFemaleMatch && currentUserProfile.gender === "MALE") {
          return res.status(403).json({
            error: {
              code: "FIRST_MESSAGE_RESTRICTED",
              message: "In male-female matches, the first message must be sent by the female. Please wait for them to message first.",
              requestId: req.id || "unknown",
            },
          });
        }
      }
    }

    // If no conversation exists, create one
    if (!conversation) {
      conversation = await (prisma as any).conversation.create({
        data: {
          requestId: request.id,
        },
      });

      // Update request status to ACCEPTED
      await (prisma as any).conversationRequest.update({
        where: { id: request.id },
        data: { status: "ACCEPTED" },
      });
    }

    // Create the reply message
    const message = await (prisma as any).message.create({
      data: {
        conversationId: conversation.id,
        senderUserId: req.user.id,
        text: body.text,
        isRequestMessage: false,
      },
    });

    // Increment message count - get user's premium status first
    const userForPremium = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { isPremium: true },
    });
    await incrementMSG(req.user.id, userForPremium?.isPremium || false);

    // Notify the sender
    const currentUserProfile = await prisma.profile.findUnique({
      where: { userId: req.user.id },
      select: { displayName: true },
    });

    if (currentUserProfile) {
      await notifyNewMessage(
        request.fromUserId,
        currentUserProfile.displayName,
        body.text
      );
    }

    res.json({
      success: true,
      conversationId: conversation.id,
      message: {
        id: message.id,
        conversationId: message.conversationId,
        senderUserId: message.senderUserId,
        text: message.text,
        createdAt: message.createdAt.toISOString(),
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

// Delete conversation (leave conversation for both users)
router.delete("/conversations/:conversationId", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw new BadRequestError("User not found");
    }

    const conversationId = req.params.conversationId;
    const userId = req.user.id;

    // Get conversation with match and request details to verify access
    const conversation = await (prisma as any).conversation.findUnique({
      where: { id: conversationId },
      include: {
        match: {
          select: {
            userAId: true,
            userBId: true,
          },
        },
        request: {
          select: {
            fromUserId: true,
            toUserId: true,
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundError("Conversation not found");
    }

    // Verify user has access to this conversation
    let hasAccess = false;
    if (conversation.match) {
      hasAccess = conversation.match.userAId === userId || conversation.match.userBId === userId;
    } else if (conversation.request) {
      hasAccess = conversation.request.fromUserId === userId || conversation.request.toUserId === userId;
    }

    if (!hasAccess) {
      throw new ForbiddenError("Access denied to this conversation");
    }

    // Delete the conversation (this will cascade delete messages)
    await (prisma as any).conversation.delete({
      where: { id: conversationId },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
