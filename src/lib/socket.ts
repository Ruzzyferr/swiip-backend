import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";
import { hashSessionToken } from "./session.js";

// Store active connections: userId -> Set of socket IDs
const userSockets = new Map<string, Set<string>>();

// Store socket to user mapping for cleanup
const socketToUser = new Map<string, string>();

let io: Server | null = null;

/**
 * Initialize Socket.IO server with session-based authentication
 */
export function initSocketServer(httpServer: HttpServer): Server {
    io = new Server(httpServer, {
        cors: {
            origin: "*", // In production, restrict this
            methods: ["GET", "POST"],
            credentials: true,
        },
        transports: ["websocket", "polling"],
        pingTimeout: 60000,
        pingInterval: 25000,
    });

    // Authentication middleware using session tokens (same as REST API)
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token || socket.handshake.query.token;

            if (!token) {
                return next(new Error("Authentication required"));
            }

            // Hash token and look up session (same as auth middleware)
            const tokenHash = hashSessionToken(token as string);
            const session = await prisma.session.findUnique({
                where: { tokenHash },
                include: { user: true },
            });

            if (!session) {
                return next(new Error("Invalid session token"));
            }

            // Check if session is expired
            if (session.expiresAt < new Date()) {
                return next(new Error("Session expired"));
            }

            // Check if user is banned
            if (session.user.isBanned) {
                return next(new Error("User account is banned"));
            }

            // Attach user ID to socket
            socket.data.userId = session.userId;
            next();
        } catch (error) {
            logger.error("[Socket] Auth error:", { error: error instanceof Error ? error.message : String(error) });
            next(new Error("Authentication failed"));
        }
    });

    io.on("connection", (socket: Socket) => {
        const userId = socket.data.userId;
        logger.info(`[Socket] User connected: ${userId}, socket: ${socket.id}`);

        // Track this connection
        if (!userSockets.has(userId)) {
            userSockets.set(userId, new Set());
        }
        userSockets.get(userId)!.add(socket.id);
        socketToUser.set(socket.id, userId);

        // Join user's personal room for direct messages
        socket.join(`user:${userId}`);

        // Handle joining a conversation room
        socket.on("join_conversation", async (conversationId: string) => {
            try {
                // Verify user has access to this conversation
                const hasAccess = await verifyConversationAccess(userId, conversationId);
                if (hasAccess) {
                    socket.join(`conversation:${conversationId}`);
                    logger.info(`[Socket] User ${userId} joined conversation ${conversationId}`);
                    socket.emit("joined_conversation", { conversationId });
                } else {
                    socket.emit("error", { message: "Access denied to conversation" });
                }
            } catch (error) {
                logger.error("[Socket] Join conversation error:", { error });
                socket.emit("error", { message: "Failed to join conversation" });
            }
        });

        // Handle leaving a conversation room
        socket.on("leave_conversation", (conversationId: string) => {
            socket.leave(`conversation:${conversationId}`);
            logger.info(`[Socket] User ${userId} left conversation ${conversationId}`);
        });

        // Handle typing indicator
        socket.on("typing_start", async (data: { conversationId: string }) => {
            try {
                const { conversationId } = data;
                const hasAccess = await verifyConversationAccess(userId, conversationId);
                if (hasAccess) {
                    // Broadcast to everyone in the conversation except sender
                    socket.to(`conversation:${conversationId}`).emit("user_typing", {
                        conversationId,
                        userId,
                    });
                }
            } catch (error) {
                logger.error("[Socket] Typing start error:", { error });
            }
        });

        socket.on("typing_stop", async (data: { conversationId: string }) => {
            try {
                const { conversationId } = data;
                const hasAccess = await verifyConversationAccess(userId, conversationId);
                if (hasAccess) {
                    socket.to(`conversation:${conversationId}`).emit("user_stopped_typing", {
                        conversationId,
                        userId,
                    });
                }
            } catch (error) {
                logger.error("[Socket] Typing stop error:", { error });
            }
        });

        // Handle disconnect
        socket.on("disconnect", (reason: string) => {
            logger.info(`[Socket] User disconnected: ${userId}, reason: ${reason}`);

            // Clean up tracking
            const sockets = userSockets.get(userId);
            if (sockets) {
                sockets.delete(socket.id);
                if (sockets.size === 0) {
                    userSockets.delete(userId);
                }
            }
            socketToUser.delete(socket.id);
        });
    });

    logger.info("[Socket] Socket.IO server initialized");
    return io;
}

/**
 * Verify user has access to a conversation
 */
async function verifyConversationAccess(userId: string, conversationId: string): Promise<boolean> {
    try {
        const conversation = await (prisma as any).conversation.findUnique({
            where: { id: conversationId },
            include: {
                match: { select: { userAId: true, userBId: true } },
                request: { select: { fromUserId: true, toUserId: true } },
            },
        });

        if (!conversation) return false;

        if (conversation.match) {
            return conversation.match.userAId === userId || conversation.match.userBId === userId;
        }

        if (conversation.request) {
            return conversation.request.fromUserId === userId || conversation.request.toUserId === userId;
        }

        return false;
    } catch (error) {
        logger.error("[Socket] Verify access error:", { error });
        return false;
    }
}

/**
 * Emit a new message to all users in a conversation (called from message routes)
 */
export function emitNewMessage(conversationId: string, message: {
    id: string;
    conversationId: string;
    senderUserId: string;
    text: string;
    audioUrl?: string | null;
    createdAt: string;
}) {
    if (!io) {
        logger.warn("[Socket] Socket.IO not initialized, cannot emit message");
        return;
    }

    io.to(`conversation:${conversationId}`).emit("new_message", message);
    logger.info(`[Socket] Emitted new message to conversation ${conversationId}`);
}

/**
 * Check if a user is currently online (has active socket connections)
 */
export function isUserOnline(userId: string): boolean {
    return userSockets.has(userId) && userSockets.get(userId)!.size > 0;
}

/**
 * Get the Socket.IO server instance
 */
export function getIO(): Server | null {
    return io;
}

/**
 * Emit a new like notification to a user
 */
export function emitNewLike(userId: string, data: {
    fromUserId: string;
    fromUserName: string;
    fromUserPhoto?: string;
    isMatch: boolean;
    matchId?: string;
    conversationId?: string;
}) {
    if (!io) {
        logger.warn("[Socket] Socket.IO not initialized, cannot emit like");
        return;
    }

    io.to(`user:${userId}`).emit("new_like", data);
    logger.info(`[Socket] Emitted new_like to user ${userId}, isMatch: ${data.isMatch}`);
}

/**
 * Emit a new match notification to both users
 */
export function emitNewMatch(userAId: string, userBId: string, data: {
    matchId: string;
    conversationId: string;
    otherUser: {
        userId: string;
        displayName: string;
        photos: string[];
    };
}) {
    if (!io) {
        logger.warn("[Socket] Socket.IO not initialized, cannot emit match");
        return;
    }

    // Send to user A with user B's info
    io.to(`user:${userAId}`).emit("new_match", {
        ...data,
        otherUser: data.otherUser,
    });

    // We need to send user A's info to user B separately (caller should handle this)
    logger.info(`[Socket] Emitted new_match to user ${userAId}`);
}

/**
 * Emit conversation update (new message preview) to update chat list
 */
export function emitConversationUpdate(userId: string, data: {
    conversationId: string;
    lastMessage: {
        text: string;
        createdAt: string;
        senderUserId: string;
    };
    unreadCount: number;
}) {
    if (!io) {
        logger.warn("[Socket] Socket.IO not initialized, cannot emit conversation update");
        return;
    }

    io.to(`user:${userId}`).emit("conversation_updated", data);
    logger.info(`[Socket] Emitted conversation_updated to user ${userId}`);
}

/**
 * Emit new chat request (FAVORITE) notification
 */
export function emitNewChatRequest(userId: string, data: {
    requestId: string;
    fromUser: {
        userId: string;
        displayName: string;
        photos: string[];
    };
    firstMessage: {
        text: string;
        createdAt: string;
    };
}) {
    if (!io) {
        logger.warn("[Socket] Socket.IO not initialized, cannot emit chat request");
        return;
    }

    io.to(`user:${userId}`).emit("new_chat_request", data);
    logger.info(`[Socket] Emitted new_chat_request to user ${userId}`);
}

