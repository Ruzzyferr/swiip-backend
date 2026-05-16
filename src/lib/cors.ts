import { getEnv } from "./env.js";
import { logger } from "./logger.js";

let warnedProductionMissing = false;

export function getAllowedOrigins(): string[] {
  const raw = getEnv().ALLOWED_ORIGINS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * CORS origin validator for `cors` package.
 *
 * Behavior:
 * - ALLOWED_ORIGINS set: only listed origins allowed.
 * - ALLOWED_ORIGINS empty + NODE_ENV !== "production": allow all (dev convenience).
 * - ALLOWED_ORIGINS empty + NODE_ENV === "production": allow all but log warning once
 *   (mobile native API requests don't send Origin; web admin should configure this).
 * - Requests without Origin header (mobile, server-to-server, curl) always pass.
 */
export function corsOriginValidator(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  if (!origin) {
    callback(null, true);
    return;
  }

  const allowed = getAllowedOrigins();
  if (allowed.length > 0) {
    if (allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
    return;
  }

  if (getEnv().NODE_ENV === "production" && !warnedProductionMissing) {
    warnedProductionMissing = true;
    logger.warn("CORS", {
      message:
        "ALLOWED_ORIGINS env not set in production; permissive CORS in effect. Configure to restrict browser access.",
    });
  }
  callback(null, true);
}

/**
 * Returns the origin config object for Socket.IO.
 * Uses the same allowlist semantics as `corsOriginValidator`.
 */
export function socketCorsOrigin(): string | string[] | boolean {
  const allowed = getAllowedOrigins();
  if (allowed.length > 0) return allowed;
  if (getEnv().NODE_ENV === "production" && !warnedProductionMissing) {
    warnedProductionMissing = true;
    logger.warn("Socket.IO CORS", {
      message:
        "ALLOWED_ORIGINS env not set in production; Socket.IO permissive. Configure to restrict browser clients.",
    });
  }
  return true;
}
