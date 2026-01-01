import rateLimit, { RateLimitRequestHandler } from "express-rate-limit";
import { Request, Response, NextFunction } from "express";

/**
 * Rate limiting configuration for different endpoint types.
 * Uses in-memory store - for production with multiple instances, use Redis store.
 */

// Error response format
const rateLimitResponse = (message: string) => ({
  error: {
    code: "RATE_LIMIT_EXCEEDED",
    message,
    requestId: "unknown",
  },
});

/**
 * General API rate limiter
 * 500 requests per minute per IP (increased for dev)
 */
export const generalLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 500, // 500 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse("Too many requests. Please try again later."),
  // Using default keyGenerator which handles IPv6 properly
});

/**
 * Auth endpoint rate limiter (login, register, verify)
 * 50 requests per 15 minutes per IP (increased for dev)
 */
export const authLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse("Too many authentication attempts. Please try again later."),
});

/**
 * Discovery/Swipe rate limiter
 * 60 requests per minute - allows fast swiping but prevents abuse
 */
export const swipeLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 swipes per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse("Swiping too fast. Please slow down."),
});

/**
 * Message sending rate limiter
 * 30 messages per minute - prevents spam
 */
export const messageLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 messages per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse("Sending messages too fast. Please slow down."),
});

/**
 * AI/Polish endpoint rate limiter
 * 20 requests per minute - prevents API cost abuse
 */
export const aiLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 AI requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse("Too many AI requests. Please try again later."),
});

/**
 * Legacy middleware for backward compatibility
 * Uses the general limiter
 */
export function rateLimiterMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  generalLimiter(req, res, next);
}
