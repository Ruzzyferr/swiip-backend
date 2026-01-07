import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

// Create a new Expo SDK client
const expo = new Expo();

/**
 * Send push notification to a user via Expo Push Notification service
 */
async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  try {
    // Get user's push tokens
    const pushTokens = await prisma.pushToken.findMany({
      where: { userId },
    });

    if (pushTokens.length === 0) {
      logger.info(`[NOTIFY] No push tokens for user ${userId}`);
      return;
    }

    // Build messages for each valid token
    const messages: ExpoPushMessage[] = [];

    for (const tokenRecord of pushTokens) {
      // Each push token looks like ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]
      if (!Expo.isExpoPushToken(tokenRecord.token)) {
        logger.warn(`[NOTIFY] Invalid Expo push token for user ${userId}: ${tokenRecord.token}`);
        continue;
      }

      messages.push({
        to: tokenRecord.token,
        sound: "default",
        title,
        body,
        data: data || {},
        badge: 1,
      });
    }

    if (messages.length === 0) {
      logger.warn(`[NOTIFY] No valid push tokens for user ${userId}`);
      return;
    }

    // Send notifications in chunks (Expo recommends max 100 per request)
    const chunks = expo.chunkPushNotifications(messages);
    const tickets: ExpoPushTicket[] = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
        logger.info(`[NOTIFY] Sent ${ticketChunk.length} notification(s) to user ${userId}`);
      } catch (error) {
        logger.error(`[NOTIFY] Error sending push notification chunk:`, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Handle any errors in tickets (e.g., invalid tokens)
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      if (ticket.status === "error") {
        const token = messages[i]?.to as string;
        logger.error(`[NOTIFY] Push notification error:`, {
          error: ticket.message,
          token: token?.slice(0, 30) + "..." // Log partial token for debugging
        });

        // If the token is invalid, remove it from database
        if (ticket.details?.error === "DeviceNotRegistered") {
          logger.info(`[NOTIFY] Removing invalid token for user ${userId}`);
          await prisma.pushToken.deleteMany({
            where: { token },
          });
        }
      }
    }
  } catch (error) {
    logger.error(`[NOTIFY] Failed to send push notification:`, {
      error: error instanceof Error ? error.message : String(error)
    });
    // Don't throw - notification failures shouldn't break the flow
  }
}

/**
 * Notify user of a new match
 */
export async function notifyNewMatch(
  userId: string,
  otherName: string
): Promise<void> {
  await sendPushNotification(
    userId,
    "Yeni Eşleşme! 💕",
    `${otherName} ile eşleştin!`,
    { type: "match" }
  );
}

/**
 * Notify user of a new message
 */
export async function notifyNewMessage(
  userId: string,
  senderName: string,
  messagePreview?: string
): Promise<void> {
  // Truncate message preview for notification
  const preview = messagePreview
    ? (messagePreview.length > 50 ? messagePreview.slice(0, 47) + "..." : messagePreview)
    : "Yeni bir mesaj gönderdi";

  await sendPushNotification(
    userId,
    senderName,
    preview,
    { type: "message", senderName }
  );
}

/**
 * Notify user of a new FAVORITE request (super like with message)
 */
export async function notifyNewFavoriteRequest(
  userId: string,
  senderName: string,
  messagePreview?: string
): Promise<void> {
  const preview = messagePreview
    ? (messagePreview.length > 50 ? messagePreview.slice(0, 47) + "..." : messagePreview)
    : "Sana bir mesaj gönderdi";

  await sendPushNotification(
    userId,
    `${senderName} senden hoşlanıyor! ⭐`,
    preview,
    { type: "favorite_request", senderName }
  );
}
