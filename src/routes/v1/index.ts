import { Router } from "express";
import authRoutes from "../../modules/auth/routes.js";
import profilesRoutes from "../../modules/profiles/routes.js";
import discoveryRoutes from "../../modules/discovery/routes.js";
import matchesRoutes from "../../modules/matches/routes.js";
import chatRoutes from "../../modules/chat/routes.js";
import aiRoutes from "../../modules/ai/routes.js";
import likesRoutes from "../../modules/likes/routes.js";
import boostRoutes from "../../modules/boost/routes.js";
import safetyRoutes from "../../modules/safety/routes.js";
import adminRoutes from "../../modules/admin/routes.js";
import billingRoutes from "../../modules/billing/routes.js";
import notificationsRoutes from "../../modules/notifications/routes.js";
import referralRoutes from "../../modules/referral/routes.js";
import webhooksRoutes from "../../modules/webhooks/routes.js";
import rewardsRoutes from "../../modules/rewards/routes.js";
import requestsRoutes from "../../modules/requests/routes.js";
import storageRoutes from "../../modules/storage/routes.js";
import healthRoutes from "../health.js";
import {
    authLimiter,
    swipeLimiter,
    messageLimiter,
    aiLimiter,
} from "../../middleware/rateLimiter.js";

const router = Router();

// Health check under v1 (no rate limit)
router.use("/health", healthRoutes);

// Module routes with appropriate rate limiters
router.use("/auth", authLimiter, authRoutes);           // Strict: 10 req/15min
router.use("/profiles", profilesRoutes);                 // Uses general limiter
router.use("/discovery", swipeLimiter, discoveryRoutes); // 60 req/min for swiping
router.use("/matches", matchesRoutes);                   // Uses general limiter
router.use("/chat", messageLimiter, chatRoutes);         // 30 msg/min
router.use("/ai", aiLimiter, aiRoutes);                  // 20 req/min for AI
router.use("/likes", likesRoutes);                       // Uses general limiter
router.use("/boost", boostRoutes);                       // Uses general limiter
router.use("/safety", safetyRoutes);                     // Uses general limiter
router.use("/admin", adminRoutes);                       // Uses general limiter
router.use("/billing", billingRoutes);                   // Uses general limiter
router.use("/notifications", notificationsRoutes);       // Uses general limiter
router.use("/referral", referralRoutes);                 // Uses general limiter
router.use("/webhooks", webhooksRoutes);                 // No rate limit for webhooks
router.use("/rewards", rewardsRoutes);                   // Uses general limiter
router.use("/requests", requestsRoutes);                 // Uses general limiter
router.use("/storage", storageRoutes);                   // Uses general limiter

export default router;
