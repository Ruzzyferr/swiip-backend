import crypto from "crypto";
import { getEnv } from "./env.js";
import { logger } from "./logger.js";

/**
 * Verify RevenueCat webhook authorization
 * RevenueCat sends the webhook secret in the Authorization header
 * This is a simple string comparison (not HMAC signature)
 */
export function verifyRevenueCatSignature(
  payload: string,
  authHeader: string
): boolean {
  const env = getEnv();
  const secret = env.REVENUECAT_WEBHOOK_SECRET;

  if (!secret) {
    logger.warn("REVENUECAT_WEBHOOK_SECRET not set, skipping verification");
    // In development, allow if secret is not set
    return env.NODE_ENV !== "production";
  }

  // RevenueCat sends the secret in Authorization header
  // Format: "Bearer <secret>" or just "<secret>"
  const receivedSecret = authHeader.startsWith("Bearer ")
    ? authHeader.substring(7)
    : authHeader;

  // Use constant-time comparison to prevent timing attacks
  const isValid = crypto.timingSafeEqual(
    Buffer.from(receivedSecret),
    Buffer.from(secret)
  );

  if (!isValid) {
    logger.error("RevenueCat authorization verification failed");
  }

  return isValid;
}

/**
 * Extract app_user_id from RevenueCat webhook payload
 */
export function extractAppUserId(payload: any): string | null {
  // RevenueCat webhook structure:
  // event.app_user_id or event.customer_info.app_user_id
  return payload?.event?.app_user_id || payload?.event?.customer_info?.app_user_id || null;
}

/**
 * Check if premium entitlement is active
 */
export function isPremiumActive(payload: any): boolean {
  // Check entitlements.active.premium
  const entitlements = payload?.event?.customer_info?.entitlements;
  if (!entitlements) {
    return false;
  }

  const premium = entitlements.active?.premium || entitlements.all?.premium;
  if (!premium) {
    return false;
  }

  // Check if entitlement is active (not expired)
  const expiresDate = premium.expires_date;
  if (expiresDate) {
    const expires = new Date(expiresDate);
    if (expires < new Date()) {
      return false; // Expired
    }
  }

  return true;
}

/**
 * Extract premium expiration date
 */
export function extractPremiumExpiresAt(payload: any): Date | null {
  const entitlements = payload?.event?.customer_info?.entitlements;
  const premium = entitlements?.active?.premium || entitlements?.all?.premium;
  
  if (!premium?.expires_date) {
    return null;
  }

  const expiresDate = new Date(premium.expires_date);
  return isNaN(expiresDate.getTime()) ? null : expiresDate;
}

/**
 * Extract event type from RevenueCat webhook
 */
export function extractEventType(payload: any): string {
  return payload?.event?.type || "unknown";
}

