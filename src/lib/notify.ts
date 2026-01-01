import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

/**
 * Notification service stubs
 * TODO: Integrate with real push notification provider (FCM, APNs, etc.)
 */

/**
 * Notify user of a new match
 */
export async function notifyNewMatch(
  userId: string,
  otherName: string
): Promise<void> {
  try {
    // Get user's push tokens
    const pushTokens = await prisma.pushToken.findMany({
      where: { userId },
    });

    // TODO: Send actual push notification via provider
    logger.info(`[NOTIFY] New match for user ${userId} with ${otherName}`);
    logger.info(`[NOTIFY] Would send to ${pushTokens.length} device(s)`);

    // For now, just log
    // In production, integrate with FCM/APNs and send:
    // {
    //   title: "New Match!",
    //   body: `You and ${otherName} liked each other`,
    //   data: { type: "match", userId }
    // }
  } catch (error) {
    logger.error(`Failed to notify new match for user ${userId}:`, { error: error instanceof Error ? error.message : String(error) });
    // Don't throw - notification failures shouldn't break the flow
  }
}

/**
 * Notify user of a new message
 */
export async function notifyNewMessage(
  userId: string,
  otherName: string
): Promise<void> {
  try {
    // Get user's push tokens
    const pushTokens = await prisma.pushToken.findMany({
      where: { userId },
    });

    // TODO: Send actual push notification via provider
    logger.info(`[NOTIFY] New message for user ${userId} from ${otherName}`);
    logger.info(`[NOTIFY] Would send to ${pushTokens.length} device(s)`);

    // For now, just log
    // In production, integrate with FCM/APNs and send:
    // {
    //   title: otherName,
    //   body: messageText, // truncated
    //   data: { type: "message", conversationId, senderUserId }
    // }
  } catch (error) {
    logger.error(`Failed to notify new message for user ${userId}:`, { error: error instanceof Error ? error.message : String(error) });
    // Don't throw - notification failures shouldn't break the flow
  }
}

